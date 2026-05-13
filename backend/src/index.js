import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

import { runMigrations } from './db/index.js';
import { cfAuthMiddleware } from './middleware/auth.js';
import { registerClient } from './ws/broadcast.js';
import { postRoutes } from './routes/posts.js';
import { missionRoutes } from './routes/missions.js';
import { pollRoutes } from './routes/polls.js';
import { cemeteryRoutes, cemeteryCharacterRoutes } from './routes/cemetery.js';
import { mapRoutes } from './routes/maps.js';
import { userRoutes, configRoutes } from './routes/users.js';
import { foundryRoutes } from './routes/foundry.js';
import { profileRoutes } from './routes/profile.js';
import { startCemeteryDecay } from './jobs/cemeteryDecay.js';
//import { pullFoundryActors } from './services/foundrySync.js';
//import { startFoundrySync } from './services/foundrySync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(join(UPLOADS_DIR, 'avatars'), { recursive: true });

const fastify = Fastify({ logger: true });

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(
    { err: error, url: request.url, method: request.method },
    'Request error',
  );
  const status = error.statusCode || 500;
  reply.code(status).send({ error: error.message || 'Internal Server Error' });
});

// ── Plugins ───────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin:         true,
  credentials:    false,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // ← adicionado
  allowedHeaders: ['Content-Type', 'X-Nimrod-Key', 'Authorization'],
});

await fastify.register(websocket);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

await fastify.register(staticFiles, {
  root: UPLOADS_DIR,
  prefix: '/uploads/',
});


// ── Public routes (no auth) ───────────────────────────────────────────────────
await fastify.register(configRoutes);
fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
fastify.get('/debug-headers', async (req) => {
  return {
    cfAccessEmail: req.headers['cf-access-authenticated-user-email'],
    cfAccessUserName: req.headers['cf-access-user-name'],
    cfRay: req.headers['cf-ray'],
    allCfHeaders: Object.keys(req.headers).filter(h => h.startsWith('cf-'))
  };
});

// ====================== AUTHENTICATION ======================
//import { cfAuthMiddleware } from './middleware/auth.js'; // já existe

// Melhoria: transformar em decorator reutilizável
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await cfAuthMiddleware(request, reply);
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  } catch (err) {
    fastify.log.error(err);
    return reply.code(401).send({ error: 'Unauthorized' });
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
fastify.register(async function wsPlugin(app) {
  app.get('/ws', { websocket: true }, async (connection, req) => {
    const socket = connection.socket;
    try {
      await cfAuthMiddleware(req);           // mantemos por enquanto
      if (!req.user) {
        socket.close(1008, 'Unauthorized');
        return;
      }
      registerClient(socket, req.user.id);
      socket.send(JSON.stringify({ type: 'CONNECTED', ts: Date.now() }));
    } catch (err) {
      socket.close(1008, 'Unauthorized');
    }
  });
});

// ── Global auth hook ──────────────────────────────────────────────────────────
fastify.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];

  if (
    path === '/health' ||
    path === '/config' ||
    path.startsWith('/uploads/') ||
    path === '/foundry/push-actors'
  ) {
    return;
  }

  // Para todas as outras rotas (incluindo /api/* e /ws já tratado acima)
  await cfAuthMiddleware(req, reply);
});

// ── Authenticated routes ──────────────────────────────────────────────────────
await fastify.register(userRoutes);
await fastify.register(postRoutes);
await fastify.register(missionRoutes);
await fastify.register(pollRoutes);
await fastify.register(cemeteryRoutes);
await fastify.register(cemeteryCharacterRoutes);
await fastify.register(mapRoutes);
await fastify.register(foundryRoutes);
await fastify.register(profileRoutes);

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await runMigrations();
  startCemeteryDecay();
  //startFoundrySync();
  //await pullFoundryActors();
  await fastify.listen({ port: parseInt(process.env.PORT) || 3001, host: '0.0.0.0' });
  console.log('🎲 foundry-nimrod backend running on port', process.env.PORT || 3001);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}