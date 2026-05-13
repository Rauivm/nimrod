import { query } from '../db/index.js';

const FALLBACK_NAMES = [
  'Rapariga', 'Quenga', 'Bitch', 'Raissa Rayana', 'Bala Halls', 'Rapariga',
];

export async function cfAuthMiddleware(request, reply) {
  const devEmail = process.env.DEV_USER_EMAIL?.trim();
  if (devEmail) {
    const devName = process.env.DEV_USER_NAME?.trim() || 'Dev User';
    const devRole = process.env.DEV_USER_ROLE?.trim() || 'PLAYER';
    request.user = await upsertUser(devEmail, devName, devRole, true);
    return;
  }

  // Production - Cloudflare
  const email = request.headers['cf-access-authenticated-user-email'];
  if (!email) {
    if (reply) return reply.code(401).send({ error: 'Unauthorized - Cloudflare Access required' });
    throw new Error('Unauthorized');
  }

  // Proteção anti-bypass
  if (!request.headers['cf-ray']) {
    if (reply) return reply.code(403).send({ error: 'Direct access forbidden' });
    throw new Error('Direct access forbidden');
  }

  const cfName = request.headers['cf-access-user-name'];
  const name = cfName?.trim() || email.split('@')[0];

  request.user = await upsertUser(email, name, 'PLAYER', false);

/*   const emailHeader = process.env.CLOUDFLARE_HEADER_EMAIL || 'cf-access-authenticated-user-email';
  const nameHeader  = process.env.CLOUDFLARE_HEADER_NAME  || 'cf-access-user-name';

  const email  = request.headers[emailHeader];
  const cfName = request.headers[nameHeader];

  if (!email) return reply.code(401).send({ error: 'Unauthorized' });

  const name = cfName || email.split('@')[0];
  request.user = await upsertUser(email, name, 'PLAYER', false); */
}

/**
 * Upsert user.
 *
 * display_name is NOT in the INSERT column list — it defaults to NULL
 * (migration 007 made it nullable). This lets the frontend detect first-login
 * and show ChooseNameModal.
 *
 * On conflict: display_name is never touched here; the user owns it.
 */
async function upsertUser(email, name, role, forceRole) {
  const sql = forceRole
    ? `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role
       RETURNING *`
    : `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name
       RETURNING *`;

  const res = await query(sql, [email, name, role]);
  return res.rows[0];
}

export function pickFallbackName() {
  return FALLBACK_NAMES[Math.floor(Math.random() * FALLBACK_NAMES.length)];
}
