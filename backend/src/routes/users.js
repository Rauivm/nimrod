import { query } from '../db/index.js';
import { getOnlineUserIds, broadcast } from '../ws/broadcast.js';

export async function userRoutes(fastify) {

  // ── GET /me ──────────────────────────────────────────────────────────────
  fastify.get('/me', async (req) => {
    const u = req.user;
    return {
      id:          u.id,
      email:       maskEmail(u.email),
      role:        u.role,
      displayName: u.display_name,
      lgpdConsent: u.lgpd_consent ?? false,
    };
  });

  // ── PATCH /me ─────────────────────────────────────────────────────────────
  fastify.patch('/me', {
    schema: {
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', minLength: 1, maxLength: 40 },
          name:        { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const displayName = req.body?.displayName ?? req.body?.name;
    if (!displayName?.trim()) {
      return reply.code(400).send({ error: 'displayName is required' });
    }

    const res = await query(
      `UPDATE users SET display_name = $1, name = $1 WHERE id = $2 RETURNING *`,
      [displayName.trim(), req.user.id],
    );

    const u = res.rows[0];
    return {
      id:          u.id,
      email:       maskEmail(u.email),
      role:        u.role,
      displayName: u.display_name,
      lgpdConsent: u.lgpd_consent ?? false,
    };
  });

  // ── POST /me/consent ──────────────────────────────────────────────────────
  fastify.post('/me/consent', async (req, reply) => {
    const { consent } = req.body ?? {};
    if (consent !== true) {
      return reply.code(400).send({ error: 'consent must be true' });
    }

    const res = await query(
      `UPDATE users SET lgpd_consent = TRUE, lgpd_consent_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.user.id],
    );

    const u = res.rows[0];
    return {
      id:          u.id,
      email:       maskEmail(u.email),
      role:        u.role,
      displayName: u.display_name,
      lgpdConsent: u.lgpd_consent,
    };
  });

  // ── GET /users ────────────────────────────────────────────────────────────
  fastify.get('/users', async () => {
    const res = await query(
      'SELECT id, display_name AS "displayName", email, role FROM users ORDER BY display_name',
      [],
    );
    return res.rows;
  });

  // ── GET /online-users ─────────────────────────────────────────────────────
  fastify.get('/online-users', async () => {
    const onlineIds = getOnlineUserIds();
    if (!onlineIds.length) return [];
    const res = await query(
      `SELECT id, display_name AS "displayName", role
         FROM users WHERE id = ANY($1) ORDER BY display_name`,
      [onlineIds],
    );
    return res.rows;
  });

  // ── PATCH /users/:id/role (GM only) ──────────────────────────────────────
  fastify.patch('/users/:id/role', {
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: { role: { type: 'string', enum: ['PLAYER', 'GM'] } },
      },
    },
  }, async (req, reply) => {
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const res = await query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
      [req.body.role, req.params.id],
    );

    if (!res.rows.length) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const updated = res.rows[0];

    // Notify ALL connected clients so anyone affected can refresh their
    // identity. The target user's AuthContext listens for ROLE_UPDATED
    // and calls /me automatically — no page reload needed.
    broadcast('ROLE_UPDATED', {
      userId: updated.id,
      role:   updated.role,
    });

    return {
      id:          updated.id,
      displayName: updated.display_name,
      role:        updated.role,
    };
  });
}

export async function configRoutes(fastify) {
  fastify.get('/config', { preHandler: [] }, async () => ({
    foundryUrl: process.env.FOUNDRY_URL || null,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 3)}***@${domain}`;
}
