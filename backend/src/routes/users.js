import { query } from '../db/index.js';
import { getOnlineUserIds, broadcast } from '../ws/broadcast.js';
import { pickFallbackName } from '../middleware/auth.js';

export async function userRoutes(fastify) {

  // ── GET /me ───────────────────────────────────────────────────────────────
  fastify.get('/me', async (req) => serializeMe(req.user));

  // ── PATCH /me/display-name ────────────────────────────────────────────────
  // First-login name assignment + general rename.
  // Empty / missing input → backend picks a random fallback (never frontend).
  fastify.patch('/me/display-name', async (req, reply) => {
    const raw = req.body?.displayName ?? req.body?.name ?? '';
    const displayName = raw.trim() || pickFallbackName();

    if (displayName.length > 40) {
      return reply.code(400).send({ error: 'displayName max 40 chars' });
    }

    const res = await query(
      `UPDATE users SET display_name = $1, name = $1 WHERE id = $2 RETURNING *`,
      [displayName, req.user.id],
    );
    const u = res.rows[0];
    broadcast('DISPLAY_NAME_UPDATED', { userId: u.id, displayName: u.display_name });
    return serializeMe(u);
  });

  // ── PATCH /me  (legacy / general update, kept for compat) ─────────────────
  fastify.patch('/me', async (req, reply) => {
    return reply.redirect(307, '/me/display-name');
  });

  // ── POST /me/consent ──────────────────────────────────────────────────────
  fastify.post('/me/consent', async (req, reply) => {
    if (req.body?.consent !== true) {
      return reply.code(400).send({ error: 'consent must be true' });
    }
    const res = await query(
      `UPDATE users SET lgpd_consent = TRUE, lgpd_consent_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.user.id],
    );
    return serializeMe(res.rows[0]);
  });

  // ── GET /users ─────────────────────────────────────────────────────────────
  fastify.get('/users', async () => {
    const res = await query(
      `SELECT id,
              COALESCE(display_name, name) AS "displayName",
              role
       FROM users ORDER BY display_name NULLS LAST`,
    );
    return res.rows;
  });

  // ── GET /online-users ──────────────────────────────────────────────────────
  fastify.get('/online-users', async () => {
    const onlineIds = getOnlineUserIds();
    if (!onlineIds.length) return [];
    const res = await query(
      `SELECT id,
              COALESCE(display_name, name) AS "displayName",
              role
       FROM users WHERE id = ANY($1) ORDER BY display_name NULLS LAST`,
      [onlineIds],
    );
    return res.rows;
  });

  // ── PATCH /users/:id/role (GM only) ───────────────────────────────────────
  fastify.patch('/users/:id/role', {
    schema: {
      body: {
        type: 'object', required: ['role'],
        properties: { role: { type: 'string', enum: ['PLAYER', 'GM'] } },
      },
    },
  }, async (req, reply) => {
    if (req.user.role !== 'GM') return reply.code(403).send({ error: 'GM only' });

    const res = await query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
      [req.body.role, req.params.id],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'User not found' });

    const updated = res.rows[0];
    broadcast('ROLE_UPDATED', { userId: updated.id, role: updated.role });
    return { id: updated.id, displayName: updated.display_name, role: updated.role };
  });
}

export async function configRoutes(fastify) {
  fastify.get('/config', { preHandler: [] }, async () => ({
    foundryUrl: process.env.FOUNDRY_URL || null,
  }));
}

// ── Serializer ────────────────────────────────────────────────────────────────
// Single place that decides what /me returns — never exposes raw email.
function serializeMe(u) {
  return {
    id:          u.id,
    email:       maskEmail(u.email),
    role:        u.role,
    displayName: u.display_name ?? null,   // null = needs first-login modal
    lgpdConsent: u.lgpd_consent ?? false,
  };
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 3)}***@${domain}`;
}
