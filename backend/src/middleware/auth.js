import { query } from '../db/index.js';

/**
 * Auth strategy:
 * 1. If DEV_USER_EMAIL is set (non-empty) → always use dev user (ignores CF headers).
 *    Changing .env + restart instantly changes identity/role.
 * 2. Otherwise → trust Cloudflare Access headers.
 * 3. No CF headers in production → 401.
 */
export async function cfAuthMiddleware(request, reply) {
  // Dev override: takes precedence over everything when set to a non-empty value.
  // docker-compose passes DEV_USER_EMAIL as empty string when unset — guard against that.
  const devEmail = process.env.DEV_USER_EMAIL?.trim();
  if (devEmail) {
    const devName = process.env.DEV_USER_NAME?.trim() || 'Dev User';
    const devRole = process.env.DEV_USER_ROLE?.trim() || 'PLAYER';
    request.user = await upsertUser(devEmail, devName, devRole, true);
    return;
  }

  // Production path: trust Cloudflare Access injected headers
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
 * @param {boolean} forceRole - true in dev mode: always write the supplied role.
 *                              false in production: preserve manually-promoted GMs.
 */
async function upsertUser(email, name, role, forceRole) {
  const sql = forceRole
    ? `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING *`
    : `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name
       RETURNING *`;

  const res = await query(sql, [email, name, role]);
  return res.rows[0];
}
