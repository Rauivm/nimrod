import { pool } from '../db/index.js';

/**
 * Resolve or auto-provision a user's Foundry mapping.
 *
 * Rules:
 *  - If the user already has a row → return it unchanged.
 *  - If the user is new:
 *    - Open a SERIALIZABLE transaction (prevents phantom reads on the count).
 *    - If zero rows exist in the table → assign GM.
 *    - Otherwise → assign PLAYER.
 *    - Insert the new row; world defaults to 'main', actor_name is null.
 *
 * Multiple GMs are explicitly allowed — there is no unique constraint on role.
 * Only the very first INSERT into an empty table gets GM; every subsequent one
 * gets PLAYER, regardless of concurrency.
 *
 * @param {import('pg').Pool} dbPool   — injectable for tests
 * @param {string}            email
 * @returns {Promise<{ role: string, world: string, actor_name: string|null }>}
 */
export async function resolveFoundryMapping(dbPool = pool, email) {
  // Fast path: existing mapping — no transaction needed.
  const existing = await dbPool.query(
    'SELECT role, world, actor_name FROM user_foundry_map WHERE email = $1',
    [email],
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  // Slow path: new user — determine role inside a serializable transaction
  // to prevent two simultaneous first-logins both seeing count=0 and both
  // becoming GM.
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    const countRes = await client.query(
      'SELECT COUNT(*)::int AS total FROM user_foundry_map',
    );
    const role = countRes.rows[0].total === 0 ? 'GM' : 'PLAYER';

    const insertRes = await client.query(
      `INSERT INTO user_foundry_map (email, role, world)
       VALUES ($1, $2, 'main')
       ON CONFLICT (email) DO UPDATE
         SET email = EXCLUDED.email   -- no-op: keep existing row intact
       RETURNING role, world, actor_name`,
      [email, role],
    );

    await client.query('COMMIT');
    return insertRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
