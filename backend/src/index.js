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
import { foundryRoutes } from './routes/foundry.js';
import { startCemeteryDecay } from './jobs/cemeteryDecay.js';
 
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });
 
const fastify = Fastify({ logger: true });
 
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error({ err: error, url: request.url, method: request.method }, 'Request error');
  const status = error.statusCode || 500;
  reply.code(status).send({ error: error.message || 'Internal Server Error' });
});
 
// ── Plugins ───────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});
 
await fastify.register(websocket);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
 
await fastify.register(staticFiles, {
  root: UPLOADS_DIR,
  prefix: '/uploads/',
});
 
// ── Helpers ───────────────────────────────────────────────────────────────────
// req.routerPath / req.routeOptions.url are only populated AFTER route
// matching. In preHandler the safest cross-version approach is to strip the
// query string from req.url and compare against that raw path.
function matchesPath(req, ...paths) {
  const raw = req.url.split('?')[0];
  return paths.includes(raw);
}
 
// ── Public routes (no auth) ───────────────────────────────────────────────────
await fastify.register(configRoutes);
fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
 
// ── WebSocket ─────────────────────────────────────────────────────────────────
// Auth runs inside the handler — the global preHandler hook does NOT fire
// for WebSocket upgrade requests in @fastify/websocket.
fastify.register(async function wsPlugin(app) {
  app.get('/ws', { websocket: true }, async (connection, req) => {
    const socket = connection.socket;

    try {
      await cfAuthMiddleware(req);

      if (!req.user) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      registerClient(socket, req.user.id);

      socket.send(JSON.stringify({
        type: 'CONNECTED',
        ts: Date.now(),
      }));
    } catch (err) {
      socket.close(1008, 'Unauthorized');
    }
  });
});
 
// ── Global preHandler: auth + LGPD guard ──────────────────────────────────────
fastify.addHook('onRequest', async (req, reply) => {
  // Public routes
  if (matchesPath(req, '/health', '/config', '/ws')) return;

  // Authenticate
  await cfAuthMiddleware(req, reply);

  if (reply.sent || !req.user) return;

  // Allow bootstrap endpoints
  if (matchesPath(req, '/me', '/me/consent', '/me/display-name')) {
    return;
  }

  // Dev bypass
  if (process.env.DEV_USER_EMAIL?.trim()) return;

/*   // LGPD guard
  if (!req.user.lgpd_consent) {
    return reply.code(403).send({
      error: 'LGPD consent required',
      code: 'LGPD_REQUIRED',
    });
  } */
});


 
// ── Authenticated routes ──────────────────────────────────────────────────────
await fastify.register(userRoutes);
await fastify.register(postRoutes);
await fastify.register(missionRoutes);
await fastify.register(pollRoutes);
await fastify.register(cemeteryRoutes);
await fastify.register(mapRoutes);
await fastify.register(foundryRoutes);
 
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