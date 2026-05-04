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

/**
 * @param {object} opts
 * @param {object} [opts.mockUser]   – If set, every request gets this user injected
 *                                     (bypasses cfAuthMiddleware). Used in tests.
 * @param {object} [opts.mockDb]     – If set, replaces the real `query` function.
 *                                     Must expose: { query: async (sql, params) => { rows } }
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
    // Test mode: inject mock user on every request
    fastify.addHook('preHandler', async (req) => {
      req.user = mockUser;
    });
  }

  // ── Foundry routes (inline, no real DB dependency) ───────────────────────
  const dbQuery = mockDb
    ? (sql, params) => mockDb.query(sql, params)
    : (await import('./db/index.js')).query;

  const secret = process.env.FOUNDRY_JWT_SECRET || 'test_secret';

  // GET /foundry/launch
  fastify.get('/foundry/launch', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });

    const foundryBaseUrl = (process.env.FOUNDRY_URL || 'https://foundry.example.com').replace(/\/$/, '');

    const { email } = req.user;

    const result = await dbQuery(
      'SELECT role, world, actor_name FROM user_foundry_map WHERE email = $1',
      [email],
    );

    if (!result.rows.length) {
      return reply.code(404).send({ error: 'Mapping not found' });
    }

    const { role, world, actor_name } = result.rows[0];

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

  // POST /nimrod/verify
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
