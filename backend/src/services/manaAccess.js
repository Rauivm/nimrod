import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool, query } from '../db/index.js';

function deny(message, statusCode = 403) {
  throw Object.assign(new Error(message), { statusCode });
}

export async function requireManaServer(req) {
  const secret = process.env.MANA_BRIDGE_SECRET;
  if (!secret || secret.length < 32) deny('Integração Mana indisponível.', 503);
  const provided = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    deny('Unauthorized', 401);
  }
}

function assertAccess(row, userId) {
  if (!row || row.user_id !== userId || row.owner_id !== userId ||
      row.execution_mode !== 'mana' || row.participant_status !== 'JOINED' ||
      !row.active || row.retired || row.dead ||
      !['WAITING', 'RUNNING'].includes(row.status) ||
      Date.now() < new Date(row.starts_at).getTime() ||
      Date.now() >= new Date(row.ends_at).getTime()) {
    deny('Personagem ou side quest não está disponível para jogar.');
  }
}

const identitySql = `SELECT ap.id AS participant_id, ap.status AS participant_status,
  pc.id AS character_id, pc.user_id AS owner_id, pc.name AS character_name,
  pc.active, pc.retired, COALESCE(pc.dead, FALSE) AS dead,
  u.id AS user_id, COALESCE(u.display_name, u.name) AS display_name,
  a.id AS activity_id, a.title, a.status, a.starts_at, a.ends_at,
  a.rules->>'execution_mode' AS execution_mode
  FROM activity_participants ap
  JOIN player_characters pc ON pc.id = ap.character_id
  JOIN users u ON u.id = pc.user_id
  JOIN activities a ON a.id = ap.activity_id`;

const lobbyIdentitySql = `SELECT pc.id AS character_id, pc.user_id AS owner_id, pc.name AS character_name,
  pc.active, pc.retired, COALESCE(pc.dead, FALSE) AS dead,
  u.id AS user_id, COALESCE(u.display_name, u.name) AS display_name
  FROM player_characters pc JOIN users u ON u.id = pc.user_id`;

function assertLobbyAccess(row, userId, expiresAt) {
  if (!row || row.user_id !== userId || row.owner_id !== userId || !row.active || row.retired || row.dead ||
      (expiresAt && Date.now() >= new Date(expiresAt).getTime())) {
    deny('Personagem indisponível ou não vinculado à sua conta.');
  }
}

function publicUrl() {
  if (!process.env.MANA_BRIDGE_SECRET || process.env.MANA_BRIDGE_SECRET.length < 32 ||
      !process.env.MANA_PUBLIC_URL) deny('Integração Mana não configurada.', 503);
  const url = new URL(process.env.MANA_PUBLIC_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    deny('URL pública Mana inválida.', 503);
  }
  return url;
}

function lobbyIdentity(row, ticket) {
  return { grant_id: ticket.id, scope: 'lobby', user_id: row.user_id, display_name: row.display_name,
    character_id: row.character_id, character_name: row.character_name,
    authorized_until: Math.min(Date.now() + 60_000, new Date(ticket.session_expires_at).getTime()) / 1000 };
}

function identity(row, grantId) {
  return {
    grant_id: grantId, user_id: row.user_id, display_name: row.display_name,
    character_id: row.character_id, character_name: row.character_name,
    activity_id: row.activity_id, activity_title: row.title, ends_at: row.ends_at,
    authorized_until: Math.min(Date.now() + 60_000, new Date(row.ends_at).getTime()) / 1000,
  };
}

export const ManaAccess = {
  async launchLobby(user, characterId) {
    const url = publicUrl();
    const row = (await query(`${lobbyIdentitySql} WHERE pc.id = $1`, [characterId])).rows[0];
    assertLobbyAccess(row, user.id);
    const token = randomBytes(32).toString('hex');
    await query(`INSERT INTO mana_launch_tickets
      (token_hash, user_id, character_id, scope, expires_at, session_expires_at)
      VALUES ($1, $2, $3, 'lobby', NOW() + INTERVAL '2 minutes', NOW() + INTERVAL '12 hours')`,
    [createHash('sha256').update(token).digest('hex'), user.id, characterId]);
    url.hash = `nimrod=${token}`;
    return { url: url.toString(), characterName: row.character_name };
  },

  async launch(user, activityId, characterId) {
    if (!process.env.MANA_BRIDGE_SECRET || process.env.MANA_BRIDGE_SECRET.length < 32 ||
        !process.env.MANA_PUBLIC_URL) deny('Integração Mana não configurada.', 503);
    const url = new URL(process.env.MANA_PUBLIC_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
      deny('URL pública Mana inválida.', 503);
    }
    const res = await query(`${identitySql} WHERE a.id = $1 AND pc.id = $2`, [activityId, characterId]);
    const row = res.rows[0];
    assertAccess(row, user.id);
    const token = randomBytes(32).toString('hex');
    await query(`INSERT INTO mana_launch_tickets (token_hash, user_id, participant_id, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')`,
    [createHash('sha256').update(token).digest('hex'), user.id, row.participant_id]);
    url.hash = `nimrod=${token}`;
    return { url: url.toString(), characterName: row.character_name };
  },

  async redeem(token) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ticket = (await client.query(`SELECT * FROM mana_launch_tickets
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [createHash('sha256').update(token).digest('hex')])).rows[0];
      if (!ticket) deny('Entrada expirada ou já utilizada.', 401);
      if (ticket.scope === 'lobby') {
        const row = (await client.query(`${lobbyIdentitySql} WHERE pc.id = $1 FOR SHARE OF pc`,
          [ticket.character_id])).rows[0];
        assertLobbyAccess(row, ticket.user_id, ticket.session_expires_at);
        const resolved = lobbyIdentity(row, ticket);
        await client.query(`UPDATE mana_launch_tickets SET consumed_at = NOW(), identity_snapshot = $2 WHERE id = $1`,
          [ticket.id, JSON.stringify(resolved)]);
        await client.query(`INSERT INTO activity_logs (user_id, event_type, new_state)
          VALUES ($1, 'mana.lobby.authorized', $2)`, [row.user_id, JSON.stringify(resolved)]);
        await client.query('COMMIT');
        return resolved;
      }
      const row = (await client.query(`${identitySql} WHERE ap.id = $1 FOR SHARE OF a, ap, pc`,
        [ticket.participant_id])).rows[0];
      assertAccess(row, ticket.user_id);
      await client.query('UPDATE mana_launch_tickets SET consumed_at = NOW() WHERE id = $1', [ticket.id]);
      await client.query(`INSERT INTO activity_logs (activity_id, user_id, event_type, new_state)
        VALUES ($1, $2, 'mana.entry.authorized', $3)`,
      [row.activity_id, row.user_id, JSON.stringify(identity(row, ticket.id))]);
      await client.query('COMMIT');
      return identity(row, ticket.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  },

  async authorize(grantId) {
    const ticket = (await query('SELECT * FROM mana_launch_tickets WHERE id = $1 AND consumed_at IS NOT NULL', [grantId])).rows[0];
    if (!ticket) deny('Entrada não autorizada.', 401);
    if (ticket.scope === 'lobby') {
      const row = (await query(`${lobbyIdentitySql} WHERE pc.id = $1`, [ticket.character_id])).rows[0];
      assertLobbyAccess(row, ticket.user_id, ticket.session_expires_at);
      return lobbyIdentity(row, { ...ticket, id: grantId });
    }
    const row = (await query(`${identitySql} WHERE ap.id = $1`, [ticket.participant_id])).rows[0];
    assertAccess(row, ticket.user_id);
    return identity(row, grantId);
  },
};
