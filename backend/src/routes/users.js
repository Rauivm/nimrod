import { query } from '../db/index.js';
import { getOnlineUserIds } from '../ws/broadcast.js';

export async function userRoutes(fastify) {
  // GET /me
  fastify.get('/me', async (req) => req.user);

  // PATCH /me
  fastify.patch('/me', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    const { name } = req.body;
    if (!name) return reply.code(400).send({ error: 'Name required' });
    const res = await query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
      [name, req.user.id]
    );
    return res.rows[0];
  });

  // GET /users (for invite UI)
  fastify.get('/users', async (req) => {
    const res = await query('SELECT id, name, email, role FROM users ORDER BY name', []);
    return res.rows;
  });

  // GET /online-users — returns full user records for currently connected WS clients
  fastify.get('/online-users', async (req) => {
    const onlineIds = getOnlineUserIds();
    if (!onlineIds.length) return [];
    const res = await query(
      'SELECT id, name, role FROM users WHERE id = ANY($1) ORDER BY name',
      [onlineIds]
    );
    return res.rows;
  });

  // PATCH /users/:id/role (GM only - promote/demote)
  fastify.patch('/users/:id/role', {
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: { role: { type: 'string', enum: ['PLAYER', 'GM'] } }
      }
    }
  }, async (req, reply) => {
    if (req.user.role !== 'GM') return reply.code(403).send({ error: 'GM only' });
    const res = await query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
      [req.body.role, req.params.id]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'User not found' });
    return res.rows[0];
  });
}

export async function configRoutes(fastify) {
  fastify.get('/config', { preHandler: [] }, async (req, reply) => {
    return {
      foundryUrl: process.env.FOUNDRY_URL || null,
    };
  });
}
