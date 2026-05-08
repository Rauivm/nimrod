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
 * GET  /foundry/asset             – proxy Foundry image URLs (no filesystem)
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
    if (!result.rows.length) {
      return reply.code(404).send({ error: 'No Foundry mapping exists for this user.' });
    }

    const mapping = result.rows[0];
    const token   = signFoundryToken({
      email,
      role:      mapping.role,
      world:     mapping.world,
      actorName: mapping.actor_name,
    });

    return { url: `${foundryBaseUrl}/nimrod-login?token=${encodeURIComponent(token)}` };
  });

  // ── POST /nimrod/verify ────────────────────────────────────────────────────
  fastify.post('/nimrod/verify', async (req, reply) => {
    const secret = process.env.FOUNDRY_JWT_SECRET;
    if (!secret) return reply.code(503).send({ error: 'Foundry JWT secret is not configured.' });

    const token = req.body?.token;
    if (!token) return reply.code(400).send({ error: 'token is required' });

    try {
      const payload = verifyFoundryToken(token);
      return reply.send(payload);
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  });

  // ── GET /foundry/mapping ───────────────────────────────────────────────────
  fastify.get('/foundry/mapping', async (req, reply) => {
    if (req.user.role !== 'GM') return reply.code(403).send({ error: 'GM only' });
    const result = await query(
      `SELECT email, role, world, actor_name AS "actorName" FROM user_foundry_map ORDER BY email`,
    );
    return result.rows;
  });

  // ── PUT /foundry/mapping ───────────────────────────────────────────────────
  fastify.put('/foundry/mapping', async (req, reply) => {
    if (req.user.role !== 'GM') return reply.code(403).send({ error: 'GM only' });

    const { email, role, world, actorName } = req.body ?? {};
    if (!email || !role || !world) {
      return reply.code(400).send({ error: 'email, role and world are required' });
    }

    const result = await query(
      `INSERT INTO user_foundry_map (email, role, world, actor_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         role = EXCLUDED.role, world = EXCLUDED.world, actor_name = EXCLUDED.actor_name
       RETURNING email, role, world, actor_name AS "actorName"`,
      [email, role, world, actorName ?? null],
    );
    return result.rows[0];
  });

  // ── DELETE /foundry/mapping/:email ─────────────────────────────────────────
  fastify.delete('/foundry/mapping/:email', async (req, reply) => {
    if (req.user.role !== 'GM') return reply.code(403).send({ error: 'GM only' });

    const result = await query(
      'DELETE FROM user_foundry_map WHERE email = $1 RETURNING email',
      [req.params.email],
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Mapping not found' });
    return { deleted: req.params.email };
  });

  // ── GET /foundry/asset ─────────────────────────────────────────────────────
  // Proxies Foundry-hosted image URLs to avoid CORS issues in the browser.
  // The `path` param is a URL path as served by Foundry (e.g. /worlds/my-world/tokens/hero.png).
  // The asset is fetched from FOUNDRY_URL and streamed to the client.
  // NO filesystem access — works while Foundry is open.
  fastify.get('/foundry/asset', async (req, reply) => {
    const { path: assetPath } = req.query;
    if (!assetPath) return reply.code(400).send({ error: 'path is required' });

    const foundryBase = process.env.FOUNDRY_URL?.replace(/\/$/, '');
    if (!foundryBase) return reply.code(503).send({ error: 'FOUNDRY_URL not configured' });

    // Only allow relative paths (no external URLs via this proxy)
    if (/^https?:\/\//i.test(assetPath)) {
      return reply.code(400).send({ error: 'Absolute URLs not allowed' });
    }

    // Prevent path traversal
    const safe = assetPath.replace(/\.\./g, '').replace(/^\/+/, '/');
    const url  = `${foundryBase}${safe.startsWith('/') ? safe : `/${safe}`}`;

    const timeout    = parseInt(process.env.FOUNDRY_SYNC_TIMEOUT_MS) || 10_000;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    try {
      const upstream = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!upstream.ok) return reply.code(upstream.status).send({ error: 'Asset not found in Foundry' });

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=3600');

      // Stream response body
      return reply.send(upstream.body);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return reply.code(504).send({ error: 'Foundry asset request timed out' });
      return reply.code(502).send({ error: 'Could not reach Foundry' });
    }
  });
  fastify.options('/foundry/push-actors', async (req, reply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Headers', 'Content-Type, X-Nimrod-Key')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .send();
  });

  fastify.post('/foundry/push-actors', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');

    const sentKey =
      req.headers['x-nimrod-key'];

    const configuredKey =
      process.env.FOUNDRY_API_KEY?.trim();

    if (!configuredKey || sentKey !== configuredKey) {
      return reply.code(401).send({
        error: 'Invalid API key',
      });
    }

    const actors =
      Array.isArray(req.body?.actors)
        ? req.body.actors
        : [];

    const { upsertFoundryActors } =
      await import('../services/foundrySync.js');

    const result =
      await upsertFoundryActors(actors);

    return {
      ok: true,
      ...result,
    };
  });
}