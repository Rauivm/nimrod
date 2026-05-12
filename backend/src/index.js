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
import { pullFoundryActors } from './services/foundrySync.js';
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

// ── WebSocket ─────────────────────────────────────────────────────────────────
fastify.register(async function wsPlugin(app) {
  app.get('/ws', { websocket: true }, async (connection, req) => {
    const socket = connection.socket;
    try {
      await cfAuthMiddleware(req);
      if (!req.user) { socket.close(1008, 'Unauthorized'); return; }
      registerClient(socket, req.user.id);
      socket.send(JSON.stringify({ type: 'CONNECTED', ts: Date.now() }));
    } catch {
      socket.close(1008, 'Unauthorized');
    }
  });
});

// ── Global auth hook ──────────────────────────────────────────────────────────
fastify.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];

  // Rotas públicas — sem auth
  if (
    path === '/health'              ||
    path === '/config'              ||
    path === '/ws'                  ||
    path === '/foundry/push-actors' // ← worker usa X-Nimrod-Key, não CF token
  ) return;

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
  await pullFoundryActors();
  await fastify.listen({ port: parseInt(process.env.PORT) || 3001, host: '0.0.0.0' });
  console.log('🎲 foundry-nimrod backend running on port', process.env.PORT || 3001);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}