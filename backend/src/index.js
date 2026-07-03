/**
 * src/index.js — entry point do servidor Nimrod.
 *
 * Arquitetura de autenticação:
 *
 *   Internet → Cloudflare Access → Cloudflare Tunnel → Fastify (localhost)
 *
 * O Fastify NÃO deve ser acessível diretamente da internet.
 * A porta 3001 não deve ser exposta no docker-compose em produção.
 * Toda a segurança de autenticação é garantida pelo Cloudflare Tunnel.
 */

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
import { isFoundryRequest } from './lib/foundryAuth.js';
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
import { startFoundryActorSyncJob } from './services/foundrySync.js';
import { patchNoteRoutes } from './routes/patchNotes.js';
import { sessionRoutes } from './routes/sessions.js';
import { arcRoutes }     from './routes/arcs.js';
import { calendarRoutes } from './routes/calendar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(join(UPLOADS_DIR, 'avatars'), { recursive: true });
mkdirSync(join(UPLOADS_DIR, 'patch-notes'), { recursive: true });

const fastify = Fastify({ logger: true });

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(
    { err: error, url: request.url, method: request.method },
    'Request error',
  );
  reply.code(error.statusCode || 500).send({
    error: error.message || 'Internal Server Error',
  });
});

// ── Plugins ───────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin:         true,
  credentials:    false,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Nimrod-Key', 'Authorization'],
});

await fastify.register(websocket);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

await fastify.register(staticFiles, {
  root:   UPLOADS_DIR,
  prefix: '/uploads/',
});

// ── Rotas públicas (sem auth) ─────────────────────────────────────────────────
await fastify.register(configRoutes);

fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

// ── WebSocket ─────────────────────────────────────────────────────────────────
fastify.register(async function wsPlugin(app) {
  app.get('/ws', { websocket: true }, async (connection, req) => {
    // @fastify/websocket ≥8: connection é o socket diretamente
    const socket = connection.socket ?? connection;
    try {
      // Cria um reply mínimo para que cfAuthMiddleware possa responder se necessário
      const fakeReply = { code: () => ({ send: () => {} }) };
      await cfAuthMiddleware(req, fakeReply);
      if (!req.user) {
        socket.close(1008, 'Unauthorized');
        return;
      }
      registerClient(socket, req.user.id);
      socket.send(JSON.stringify({ type: 'CONNECTED', ts: Date.now() }));
    } catch {
      socket.close(1008, 'Unauthorized');
    }
  });
});

// ── Hook de autenticação global ───────────────────────────────────────────────
fastify.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];

  // Rotas que não precisam de autenticação
  if (
    path === '/health'              ||
    path === '/config'              ||
    path === '/ws'                  ||
    path.startsWith('/uploads/')    ||
    path === '/nimrod/verify'           ||
    path === '/nimrod/handshake'        ||
    path === '/nimrod/handshake/status' ||
    path === '/nimrod/session/presence' ||
    path === '/nimrod/session/status'   ||
    path === '/nimrod/session/enter'    ||
    path === '/nimrod/session/leave'    ||
    path === '/foundry/push-actors'       // autenticado por X-Nimrod-Key na rota
  ) return;

  // POST /sessions/:id/events aceita dois caminhos de autenticação:
  //   - Cloudflare Access (humano, via UI do Nimrod) → segue o fluxo normal abaixo
  //   - X-Nimrod-Key (módulo Foundry) → pula cfAuthMiddleware; a própria rota
  //     valida a chave novamente (via isFoundryRequest) e não depende de req.user.
  // Chave ausente ou inválida cai no fluxo normal (nega acesso não autenticado).
  if (/^\/sessions\/[^/]+\/events$/.test(path) && req.method === 'POST') {
    if (await isFoundryRequest(req)) return; // rota trata como origem Foundry
  }

  await cfAuthMiddleware(req, reply);
});

// ── Rotas autenticadas ────────────────────────────────────────────────────────
await fastify.register(userRoutes);
await fastify.register(postRoutes);
await fastify.register(missionRoutes);
await fastify.register(pollRoutes);
await fastify.register(cemeteryRoutes);
await fastify.register(cemeteryCharacterRoutes);
await fastify.register(mapRoutes);
await fastify.register(foundryRoutes);
await fastify.register(profileRoutes);
await fastify.register(sessionRoutes);
await fastify.register(arcRoutes);
await fastify.register(patchNoteRoutes);
await fastify.register(calendarRoutes);

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await runMigrations();
  startCemeteryDecay();
  startFoundryActorSyncJob();
  await fastify.listen({
    port: parseInt(process.env.PORT) || 3001,
    host: '0.0.0.0',   // necessário para Docker — proteção é feita pelo Tunnel + firewall
  });
  console.log('🎲 Nimrod backend running on port', process.env.PORT || 3001);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}