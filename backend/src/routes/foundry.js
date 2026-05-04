import { query } from '../db/index.js';

/**
 * Foundry VTT integration routes.
 *
 * Constraints:
 *  - No Foundry DB access
 *  - No auth override
 *  - No passwords stored
 *  - Pure URL generation + contextual query params
 */
export async function foundryRoutes(fastify) {
  /**
   * GET /foundry/launch
   *
   * Resolves the authenticated user's Foundry mapping and returns a
   * pre-built launch URL.  The client opens it in a new tab; Foundry's
   * client-side module reads the query params and surfaces the character.
   *
   * Response 200: { url: string }
   * Response 404: { error: string }  — user not mapped yet
   * Response 503: { error: string }  — FOUNDRY_URL env var missing
   */
  fastify.get('/foundry/launch', async (req, reply) => {
    const foundryBaseUrl = process.env.FOUNDRY_URL?.replace(/\/$/, '');

    if (!foundryBaseUrl) {
      return reply.code(503).send({
        error: 'Foundry URL is not configured on the server.',
      });
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

    const params = new URLSearchParams({ world, role });
    if (actor_name) params.set('actor', actor_name);

    const url = `${foundryBaseUrl}?${params.toString()}`;

    return reply.send({ url });
  });

  /**
   * GET /foundry/mapping (GM only)
   *
   * Returns all mappings so the GM can inspect / manage them from the UI.
   */
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

  /**
   * PUT /foundry/mapping (GM only)
   *
   * Upserts a single user mapping.
   *
   * Body: { email, role, world, actor_name? }
   */
  fastify.put('/foundry/mapping', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'role', 'world'],
        properties: {
          email:      { type: 'string', format: 'email' },
          role:       { type: 'string', enum: ['GM', 'PLAYER'] },
          world:      { type: 'string', minLength: 1 },
          actor_name: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const { email, role, world, actor_name = null } = req.body;

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

  /**
   * DELETE /foundry/mapping/:email (GM only)
   */
  fastify.delete('/foundry/mapping/:email', async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const { email } = req.params;

    const result = await query(
      'DELETE FROM user_foundry_map WHERE email = $1 RETURNING email',
      [email],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Mapping not found' });
    }

    return reply.code(200).send({ deleted: email });
  });
}
