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
      return reply.code(503).send({
        error: 'Foundry URL is not configured on the server.',
      });
    }

    const secret = process.env.FOUNDRY_JWT_SECRET;

    if (!secret) {
      return reply.code(503).send({
        error: 'Foundry JWT secret is not configured.',
      });
    }

    const { email } = req.user;

    const result = await query(
      'SELECT role, world, actor_name FROM user_foundry_map WHERE email = $1',
      [email],
    );

    if (!result.rows.length) {
      return reply.code(404).send({
        error: 'No Foundry mapping exists for this user.',
      });
    }

    const mapping = result.rows[0];

    const token = signFoundryToken({
      email,
      role: mapping.role,
      world: mapping.world,
      actorName: mapping.actor_name,
    });

    return {
      url: `${foundryBaseUrl}/nimrod-login?token=${encodeURIComponent(token)}`,
    };
  });

  // ── POST /nimrod/verify ────────────────────────────────────────────────────
  fastify.post('/nimrod/verify', async (req, reply) => {
    const secret = process.env.FOUNDRY_JWT_SECRET;

    if (!secret) {
      return reply.code(503).send({
        error: 'Foundry JWT secret is not configured.',
      });
    }

    const token = req.body?.token;

    if (!token) {
      return reply.code(400).send({
        error: 'token is required',
      });
    }

    try {
      const payload = verifyFoundryToken(token);
      return reply.send(payload);
    } catch {
      return reply.code(401).send({
        error: 'Invalid token',
      });
    }
  });

  // ── GET /foundry/mapping ───────────────────────────────────────────────────
  fastify.get('/foundry/mapping', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({
        error: 'GM only',
      });
    }

    const result = await query(`
      SELECT
        email,
        role,
        world,
        actor_name AS "actorName"
      FROM user_foundry_map
      ORDER BY email
    `);

    return result.rows;
  });

  // ── PUT /foundry/mapping ───────────────────────────────────────────────────
  fastify.put('/foundry/mapping', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({
        error: 'GM only',
      });
    }

    const {
      email,
      role,
      world,
      actorName,
    } = req.body ?? {};

    if (!email || !role || !world) {
      return reply.code(400).send({
        error: 'email, role and world are required',
      });
    }

    const result = await query(`
      INSERT INTO user_foundry_map (
        email,
        role,
        world,
        actor_name
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email)
      DO UPDATE SET
        role = EXCLUDED.role,
        world = EXCLUDED.world,
        actor_name = EXCLUDED.actor_name
      RETURNING
        email,
        role,
        world,
        actor_name AS "actorName"
    `, [
      email,
      role,
      world,
      actorName ?? null,
    ]);

    return result.rows[0];
  });

  // ── DELETE /foundry/mapping/:email ─────────────────────────────────────────
  fastify.delete('/foundry/mapping/:email', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({
        error: 'GM only',
      });
    }

    const result = await query(
      'DELETE FROM user_foundry_map WHERE email = $1 RETURNING email',
      [req.params.email],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({
        error: 'Mapping not found',
      });
    }

    return reply.code(200).send({
      deleted: req.params.email,
    });
  });

  // ── GET /foundry/asset ─────────────────────────────────────────────────────
  // Proxies Foundry-hosted assets/images to avoid CORS issues.
  // Only serves files inside FOUNDRY_DATA_PATH.
  fastify.get('/foundry/asset', async (req, reply) => {
    const { path: assetPath } = req.query;

    if (!assetPath) {
      return reply.code(400).send({
        error: 'path is required',
      });
    }

    const dataPath = process.env.FOUNDRY_DATA_PATH;

    if (!dataPath) {
      return reply.code(503).send({
        error: 'FOUNDRY_DATA_PATH not configured',
      });
    }

    const { join, resolve, normalize } = await import('path');

    // Prevent path traversal
    const safe = normalize(assetPath)
      .replace(/^\/+/, '')
      .replace(/^(\.\.\/)+/, '');

    const abs = resolve(join(dataPath, safe));

    if (!abs.startsWith(resolve(dataPath))) {
      return reply.code(403).send({
        error: 'Forbidden',
      });
    }

    const { existsSync, createReadStream } = await import('fs');

    if (!existsSync(abs)) {
      return reply.code(404).send({
        error: 'Not found',
      });
    }

    const ext = abs.split('.').pop()?.toLowerCase();

    const mimeMap = {
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      png:  'image/png',
      webp: 'image/webp',
      gif:  'image/gif',
      svg:  'image/svg+xml',
    };

    reply.header(
      'Content-Type',
      mimeMap[ext] || 'application/octet-stream',
    );

    reply.header(
      'Cache-Control',
      'public, max-age=3600',
    );

    return reply.send(createReadStream(abs));
  });
}