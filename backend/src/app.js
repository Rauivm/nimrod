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
} = process.env;

const IS_PROD = NODE_ENV === 'production';

function getFoundryJwtSecret() {
  return process.env.FOUNDRY_JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-secret' : null);
}

function getFoundryBaseUrl() {
  const publicUrl = process.env.FOUNDRY_PUBLIC_URL?.trim();
  if (publicUrl) return publicUrl.replace(/\/$/, '');

  const configuredUrl = (
    process.env.FOUNDRY_URL ||
    (process.env.NODE_ENV === 'test' ? 'http://foundry.test' : null)
  )?.trim();
  if (!configuredUrl) return null;

  const devUrl = process.env.FOUNDRY_LOCAL_URL?.trim() || process.env.FOUNDRY_DEV_URL?.trim();
  if (process.env.NODE_ENV !== 'production' && configuredUrl.includes('host.docker.internal')) {
    return (devUrl || configuredUrl.replace('host.docker.internal', 'localhost')).replace(/\/$/, '');
  }

  return configuredUrl.replace(/\/$/, '');
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
    if (!IS_PROD && process.env.DEV_USER_EMAIL) {
      req.user = {
        email: process.env.DEV_USER_EMAIL,
        role:  process.env.DEV_USER_ROLE || 'PLAYER',
        name:  process.env.DEV_USER_NAME || 'Dev User',
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

    const foundryBaseUrl = getFoundryBaseUrl();
    const secret = getFoundryJwtSecret();
    if (!foundryBaseUrl) return reply.code(503).send({ error: 'FOUNDRY_URL is required' });
    if (!secret) return reply.code(503).send({ error: 'FOUNDRY_JWT_SECRET is required' });

    const mapping        = await resolveFoundryMapping(dbPool, req.user.email);
    const { role, world, actor_name } = mapping;

    const payload = {
      e:   req.user.email,
      r:   role,
      w:   world,
      a:   actor_name || null,
      exp: Math.floor(Date.now() / 1000) + 300,   // 5 minutos
    };

    const token = signFoundryToken(payload, secret);
    const url   = new URL(foundryBaseUrl);
    url.searchParams.set('t', token);

    return reply.send({ url: url.toString() });
  });

  fastify.post('/nimrod/verify', async (req, reply) => {
    const { token } = req.body ?? {};
    if (!token) return reply.code(400).send({ error: 'token is required' });

    const secret = getFoundryJwtSecret();
    if (!secret) return reply.code(503).send({ error: 'FOUNDRY_JWT_SECRET is required' });

    try {
      const payload = verifyFoundryToken(token, secret);
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
