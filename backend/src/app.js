/**
 * app.js — Fastify application factory.
 *
 * Usado APENAS para testes de integração.
 * O servidor de produção usa src/index.js diretamente.
 *
 * Rotas disponíveis aqui:
 *   GET  /health
 *   GET  /foundry/launch
 *   POST /nimrod/verify
 *
 * O middleware de autenticação completo (com upsert no PostgreSQL) fica em
 * src/middleware/auth.js e é usado pelo index.js de produção. Aqui usamos
 * uma versão simplificada compatível com testes (mockUser / DEV_USER_EMAIL).
 */

import Fastify from 'fastify';
import { signFoundryToken, verifyFoundryToken } from './services/foundryAuth.js';
import { resolveFoundryMapping } from './services/foundryMap.js';

const {
  NODE_ENV    = 'development',
  DEV_USER_EMAIL,
  DEV_USER_NAME  = 'Dev User',
  DEV_USER_ROLE  = 'PLAYER',
  FOUNDRY_URL,
  FOUNDRY_JWT_SECRET,
} = process.env;

const IS_PROD = NODE_ENV === 'production';

if (!FOUNDRY_JWT_SECRET) {
  throw new Error('FOUNDRY_JWT_SECRET is required');
}

export async function build({ mockUser = null, mockDb = null, logger = false } = {}) {
  const fastify = Fastify({ logger });

  fastify.setErrorHandler((error, request, reply) => {
    request.log?.error(error);
    return reply.code(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // ── DB ─────────────────────────────────────────────────────────────────────
  const dbPool = mockDb ?? (await import('./db/index.js')).pool;

  // ── Auth ───────────────────────────────────────────────────────────────────
  fastify.addHook('preHandler', async (req, reply) => {
    // Testes: injeta usuário direto
    if (mockUser) {
      req.user = mockUser;
      return;
    }

    // Desenvolvimento local
    if (!IS_PROD && DEV_USER_EMAIL) {
      req.user = {
        email: DEV_USER_EMAIL,
        role:  DEV_USER_ROLE,
        name:  DEV_USER_NAME,
      };
      return;
    }

    // Produção: header injetado pelo Cloudflare Access via Tunnel
    const email = req.headers['cf-access-authenticated-user-email']?.trim().toLowerCase();
    if (!email) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    req.user = { email };
  });

  // ── Rotas ──────────────────────────────────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok' }));

  fastify.get('/foundry/launch', async (req, reply) => {
    if (!req.user?.email) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const foundryBaseUrl = (FOUNDRY_URL || 'https://foundry.example.com').replace(/\/$/, '');
    const mapping        = await resolveFoundryMapping(dbPool, req.user.email);
    const { role, world, actor_name } = mapping;

    const payload = {
      e:   req.user.email,
      r:   role,
      w:   world,
      a:   actor_name || null,
      exp: Math.floor(Date.now() / 1000) + 300,   // 5 minutos
    };

    const token = signFoundryToken(payload, FOUNDRY_JWT_SECRET);
    const url   = new URL(foundryBaseUrl);
    url.searchParams.set('t', token);

    return reply.send({ url: url.toString() });
  });

  fastify.post('/nimrod/verify', async (req, reply) => {
    const { token } = req.body ?? {};
    if (!token) return reply.code(400).send({ error: 'token is required' });

    try {
      const payload = verifyFoundryToken(token, FOUNDRY_JWT_SECRET);
      return reply.send({
        email: payload.e,
        role:  payload.r,
        world: payload.w,
        actor: payload.a ?? null,
      });
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  });

  await fastify.ready();
  return fastify;
}
