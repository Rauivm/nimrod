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
import { cemeteryRoutes } from './routes/cemetery.js';
import { mapRoutes } from './routes/maps.js';
import { userRoutes, configRoutes } from './routes/users.js';
import { startCemeteryDecay } from './jobs/cemeteryDecay.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });

const fastify = Fastify({ logger: true });

// ── Global error handler — must be registered BEFORE listen ──────────────────
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(
    { err: error, url: request.url, method: request.method },
    'Request error'
  );
  const status = error.statusCode || 500;
  reply.code(status).send({
    error: error.message || 'Internal Server Error',
  });
});

// ── Plugins ───────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});

await fastify.register(websocket);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

await fastify.register(staticFiles, {
  root: join(process.cwd(), UPLOADS_DIR),
  prefix: '/uploads/',
});

// ── Public routes (no auth) ───────────────────────────────────────────────────
await fastify.register(configRoutes);

fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

// ── WebSocket (auth inside handler) ──────────────────────────────────────────
fastify.register(async function wsPlugin(app) {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    let user = null;
    const fakeReply = { code: () => fakeReply, send: () => fakeReply };
    try {
      await cfAuthMiddleware(req, fakeReply);
      user = req.user;
    } catch {}

    if (!user) {
      socket.send(JSON.stringify({ type: 'ERROR', error: 'Unauthorized' }));
      socket.close(1008, 'Unauthorized');
      return;
    }

    registerClient(socket, user.id);
    socket.send(JSON.stringify({ type: 'CONNECTED', ts: Date.now() }));
  });
});

// ── Authenticated routes ──────────────────────────────────────────────────────
fastify.addHook('preHandler', cfAuthMiddleware);

await fastify.register(userRoutes);
await fastify.register(postRoutes);
await fastify.register(missionRoutes);
await fastify.register(pollRoutes);
await fastify.register(cemeteryRoutes);
await fastify.register(mapRoutes);

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await runMigrations();
  startCemeteryDecay();
  await fastify.listen({ port: parseInt(process.env.PORT) || 3001, host: '0.0.0.0' });
  console.log('🎲 foundry-nimrod backend running on port', process.env.PORT || 3001);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
