/**
 * app.js — Fastify application factory.
 */

import Fastify from 'fastify';
import jwt from 'jsonwebtoken';

import { signFoundryToken, verifyFoundryToken } from './services/foundryAuth.js';
import { resolveFoundryMapping } from './services/foundryMap.js';

const {
  NODE_ENV = 'development',
  DEV_USER_EMAIL,
  DEV_USER_ROLE = 'PLAYER',
  DEV_USER_NAME = 'Dev',
  FOUNDRY_URL,
  FOUNDRY_JWT_SECRET,
  CLOUDFLARE_ACCESS_JWT_SECRET,
} = process.env;

const IS_PROD = NODE_ENV === 'production';

if (!FOUNDRY_JWT_SECRET) {
  throw new Error('FOUNDRY_JWT_SECRET is required');
}

if (IS_PROD && !CLOUDFLARE_ACCESS_JWT_SECRET) {
  throw new Error('CLOUDFLARE_ACCESS_JWT_SECRET is required in production');
}

function extractCloudflareIdentity(req) {
  const cfJwt = req.headers['cf-access-jwt-assertion'];

  if (!cfJwt) {
    return null;
  }

  try {
    const payload = jwt.verify(cfJwt, CLOUDFLARE_ACCESS_JWT_SECRET);

    return {
      email:
        payload.email ||
        payload.sub ||
        payload['cf-access-authenticated-user-email'],
    };
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {object} [opts.mockUser]
 * @param {object} [opts.mockDb]
 * @param {boolean} [opts.logger]
 */
export async function build({
  mockUser = null,
  mockDb = null,
  logger = false,
} = {}) {
  const fastify = Fastify({
    logger,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Error handler
  // ───────────────────────────────────────────────────────────────────────────

  fastify.setErrorHandler((error, request, reply) => {
    const status = error.statusCode || 500;

    if (logger) {
      request.log.error(error);
    }

    return reply.code(status).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Authentication
  // ───────────────────────────────────────────────────────────────────────────

  fastify.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];

    // 1. Bypass para rotas públicas e internas
    if (
      path === '/health' ||
      path === '/config' ||
      path === '/foundry/push-actors' ||
      path.startsWith('/api/') // Permite que as rotas tratem a própria auth ou sejam públicas
    ) {
      return;
    }

    // 2. Bypass para desenvolvimento local
    if (!IS_PROD && DEV_USER_EMAIL) {
      req.user = { email: DEV_USER_EMAIL, role: DEV_USER_ROLE, name: DEV_USER_NAME };
      return;
    }

    // 3. Validação Cloudflare em Produção
    const email = req.headers['cf-access-authenticated-user-email'];
    if (IS_PROD && !email) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    req.user = { email };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DB wiring
  // ───────────────────────────────────────────────────────────────────────────

  const dbPool = mockDb ?? (await import('./db/index.js')).pool;

  // ───────────────────────────────────────────────────────────────────────────
  // Routes
  // ───────────────────────────────────────────────────────────────────────────

  fastify.get('/api/me', async (req) => {
    return {
      authenticated: true,
      user: {
        email: req.user.email,
      },
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /foundry/launch
  // ───────────────────────────────────────────────────────────────────────────

  fastify.get('/foundry/launch', async (req, reply) => {
    if (!req.user?.email) {
      return reply.code(401).send({
        error: 'Unauthorized',
      });
    }

    const foundryBaseUrl = (
      FOUNDRY_URL || 'https://foundry.example.com'
    ).replace(/\/$/, '');

    const mapping = await resolveFoundryMapping(
      dbPool,
      req.user.email,
    );

    const {
      role,
      world,
      actor_name,
    } = mapping;

    const payload = {
      e: req.user.email,
      r: role,
      w: world,
      a: actor_name || null,

      // 5 minutes
      exp: Math.floor(Date.now() / 1000) + 300,
    };

    const token = signFoundryToken(
      payload,
      FOUNDRY_JWT_SECRET,
    );

    const url = new URL(foundryBaseUrl);

    url.searchParams.set('t', token);

    return reply.send({
      url: url.toString(),
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /nimrod/verify
  // ───────────────────────────────────────────────────────────────────────────

  fastify.post('/nimrod/verify', async (req, reply) => {
    const { token } = req.body ?? {};

    if (!token) {
      return reply.code(400).send({
        error: 'token is required',
      });
    }

    try {
      const payload = verifyFoundryToken(
        token,
        FOUNDRY_JWT_SECRET,
      );

      return reply.send({
        email: payload.e,
        role: payload.r,
        world: payload.w,
        actor: payload.a ?? null,
      });
    } catch {
      return reply.code(401).send({
        error: 'Invalid token',
      });
    }
  });

  await fastify.ready();

  return fastify;
}