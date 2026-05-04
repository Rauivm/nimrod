import { query } from '../db/index.js';
import { signFoundryToken, verifyFoundryToken } from '../services/foundryAuth.js';

/**
 * Foundry VTT integration routes.
 *
 * GET  /foundry/launch            – returns signed-JWT launch URL
 * POST /nimrod/verify             – Foundry module calls to decode JWT
 * GET  /foundry/mapping           – GM: list all mappings
 * PUT  /foundry/mapping           – GM: upsert mapping
 * DELETE /foundry/mapping/:email  – GM: remove mapping
 */
export async function foundryRoutes(fastify) {

  // ── GET /foundry/launch ────────────────────────────────────────────────────
  fastify.get('/foundry/launch', async (req, reply) => {
    const foundryBaseUrl = process.env.FOUNDRY_URL?.replace(/\/$/, '');
    if (!foundryBaseUrl) {
      return reply.code(503).send({ error: 'Foundry URL is not configured on the server.' });
    }

    const secret = process.env.FOUNDRY_JWT_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: 'Foundry JWT secret is not configured.' });
    }

    const { email } = req.user;

    const result = await query(
      'SELECT role, world, actor_name FROM user_foundry_map WHERE email = $1',
      [email],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({
        error: 'No Foundry mapping found for this user. Ask your GM to set one up.',
      });
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
    const url   = `${foundryBaseUrl}?t=${token}`;

    return reply.send({ url });
  });

  // ── POST /nimrod/verify ───────────────────────────────────────────────────
  fastify.post('/nimrod/verify', async (req, reply) => {
    const { token } = req.body ?? {};

    if (!token) {
      return reply.code(400).send({ error: 'token is required' });
    }

    const secret = process.env.FOUNDRY_JWT_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: 'JWT secret not configured' });
    }

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

  // ── GET /foundry/mapping (GM only) ────────────────────────────────────────
  fastify.get('/foundry/mapping', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const result = await query(
      'SELECT email, role, world, actor_name FROM user_foundry_map ORDER BY role, email',
      [],
    );

    return reply.send(result.rows);
  });

  // ── PUT /foundry/mapping (GM only) ────────────────────────────────────────
  fastify.put('/foundry/mapping', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const { email, role, world, actor_name = null } = req.body ?? {};

    if (!email || !role || !world) {
      return reply.code(400).send({ error: 'email, role and world are required' });
    }

    if (!['GM', 'PLAYER'].includes(role)) {
      return reply.code(400).send({ error: 'role must be GM or PLAYER' });
    }

    const result = await query(
      `INSERT INTO user_foundry_map (email, role, world, actor_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET role       = EXCLUDED.role,
             world      = EXCLUDED.world,
             actor_name = EXCLUDED.actor_name
       RETURNING *`,
      [email, role, world, actor_name],
    );

    return reply.code(200).send(result.rows[0]);
  });

  // ── DELETE /foundry/mapping/:email (GM only) ──────────────────────────────
  fastify.delete('/foundry/mapping/:email', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const result = await query(
      'DELETE FROM user_foundry_map WHERE email = $1 RETURNING email',
      [req.params.email],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Mapping not found' });
    }

    return reply.code(200).send({ deleted: req.params.email });
  });
}
