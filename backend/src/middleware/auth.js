import { query } from '../db/index.js';

/**
 * Auth strategy:
 * 1. If DEV_USER_EMAIL is set (non-empty) → always use dev user (ignores CF headers).
 *    Changing .env + restart instantly changes identity/role.
 * 2. Otherwise → trust Cloudflare Access headers.
 * 3. No CF headers in production → 401.
 *
 * After upsert, req.user is guaranteed to have:
 *   { id, email, name, display_name, role, lgpd_consent, lgpd_consent_at, ... }
 */
export async function cfAuthMiddleware(request, reply) {
  const devEmail = process.env.DEV_USER_EMAIL?.trim();
  if (devEmail) {
    const devName = process.env.DEV_USER_NAME?.trim() || 'Dev User';
    const devRole = process.env.DEV_USER_ROLE?.trim() || 'PLAYER';
    request.user = await upsertUser(devEmail, devName, devRole, true);
    return;
  }

  const emailHeader = process.env.CLOUDFLARE_HEADER_EMAIL || 'cf-access-authenticated-user-email';
  const nameHeader  = process.env.CLOUDFLARE_HEADER_NAME  || 'cf-access-user-name';

  const email  = request.headers[emailHeader];
  const cfName = request.headers[nameHeader];

  if (!email) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  const name = cfName || email.split('@')[0];
  request.user = await upsertUser(email, name, 'PLAYER', false);
}

/**
 * Insert or update a user row, deriving display_name from email on first insert.
 *
 * @param {string}  email
 * @param {string}  name        – from CF header or email prefix
 * @param {string}  role        – 'GM' | 'PLAYER'
 * @param {boolean} forceRole   – true in dev: always overwrite role
 */
async function upsertUser(email, name, role, forceRole) {
  // Derive a clean nickname from the local-part of the email (before @).
  const derivedDisplayName = email.split('@')[0].toLowerCase();

  const sql = forceRole
    ? `INSERT INTO users (email, name, display_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET name         = EXCLUDED.name,
             display_name = COALESCE(users.display_name, EXCLUDED.display_name),
             role         = EXCLUDED.role
       RETURNING *`
    : `INSERT INTO users (email, name, display_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET name         = EXCLUDED.name,
             display_name = COALESCE(users.display_name, EXCLUDED.display_name)
       RETURNING *`;

  const res = await query(sql, [email, name, derivedDisplayName, role]);
  return res.rows[0];
}
