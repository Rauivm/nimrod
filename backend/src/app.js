/**
 * app.js — Fastify application factory.
 *
 * Separates server construction from server startup so that tests can call
 * build({ mockUser, mockDb }) without binding a port or touching the database.
 *
 * Production entry point (src/index.js) calls build() then app.listen().
 */

import Fastify from 'fastify';
import { signFoundryToken, verifyFoundryToken } from './services/foundryAuth.js';
import { resolveFoundryMapping } from './services/foundryMap.js';

/**
 * @param {object} opts
 * @param {object} [opts.mockUser]   – If set, every request gets this user injected
 *                                     (bypasses cfAuthMiddleware). Used in tests.
 * @param {object} [opts.mockDb]     – Pool-compatible mock: { query, connect? }.
 *                                     connect() must return a client stub for
 *                                     transaction-path tests.
 * @param {boolean} [opts.logger]    – Fastify logger flag (default false in tests)
 */
export async function build({ mockUser = null, mockDb = null, logger = false } = {}) {
  const fastify = Fastify({ logger });

  // ── Error handler ─────────────────────────────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    const status = error.statusCode || 500;
    reply.code(status).send({ error: error.message || 'Internal Server Error' });
  });

  // ── Auth decoration ───────────────────────────────────────────────────────
  if (mockUser) {
    fastify.addHook('preHandler', async (req) => {
      req.user = mockUser;
    });
  }

  // ── DB + service wiring ───────────────────────────────────────────────────
  // mockDb must be pool-shaped: { query, connect? }.
  // resolveFoundryMapping receives the pool directly so tests can inject it.
  const dbPool = mockDb ?? (await import('./db/index.js')).pool;

  const secret = process.env.FOUNDRY_JWT_SECRET || 'test_secret';

  // ── GET /foundry/launch ───────────────────────────────────────────────────
  // Auto-provisions a Foundry mapping for first-time users.
  // First user in an empty table → GM. All subsequent → PLAYER.
  // Existing users are never modified.
  fastify.get('/foundry/launch', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });

    const foundryBaseUrl = (process.env.FOUNDRY_URL || 'https://foundry.example.com').replace(/\/$/, '');
    const { email } = req.user;

    const mapping = await resolveFoundryMapping(dbPool, email);
    const { role, world, actor_name } = mapping;

    const payload = {
      e:   email,
      r:   role,
      w:   world,
      a:   actor_name || null,
      exp: Math.floor(Date.now() / 1000) + 60,
    };

    const token = signFoundryToken(payload, secret);
    return reply.send({ url: `${foundryBaseUrl}?t=${token}` });
  });

  // ── POST /nimrod/verify ───────────────────────────────────────────────────
  fastify.post('/nimrod/verify', async (req, reply) => {
    const { token } = req.body ?? {};
    if (!token) return reply.code(400).send({ error: 'token is required' });

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
