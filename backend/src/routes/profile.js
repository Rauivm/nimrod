/**
 * routes/profile.js
 *
 * Player profile endpoints:
 *  GET  /players/:userId/profile          — full profile (public)
 *  GET  /players/:userId/characters       — character list
 *  POST /players/:userId/characters       — GM: manually add a character
 *  PATCH /players/:userId/characters/:id  — GM: link actor to user / retire
 *  DELETE /players/:userId/characters/:id — GM: unlink
 *
 *  GET  /foundry/actors/unlinked          — GM: actors without a user link
 *  POST /foundry/actors/sync              — GM: trigger manual sync
 *
 *  POST /me/avatar                        — upload profile picture
 */

import { createWriteStream, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { isGM, isAdmin, requireGMPrincipal } from '../lib/roles.js';

const ALLOWED_IMG_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES  = 4 * 1024 * 1024; // 4 MB

function avatarsDir() {
  const base = process.env.UPLOADS_DIR || 'uploads';
  const dir  = join(base, 'avatars');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Character serialiser ──────────────────────────────────────────────────────
function serializeChar(row, missionCount = 0) {
  return {
    id:            row.id,
    foundryActorId: row.foundry_actor_id,
    name:          row.name,
    level:         row.level,
    xp:            row.xp,
    xpNext:        row.xp_next,
    tokenImg:      row.token_img,
    portraitImg:   row.portrait_img,
    biography:     row.biography,
    system:        row.system,
    classe:        row.classe,
    race:          row.race,
    dead:          row.dead ?? false,
    active:        row.active,
    retired:       row.retired,
    retiredAt:     row.retired_at,
    lastSyncedAt:  row.last_synced_at,
    missionCount,
    missionsCount: missionCount,
    userId:        row.user_id,
    userDisplayName: row.user_display_name ?? null,
  };
}

async function uploadAvatar(req, reply) {
  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  if (!ALLOWED_IMG_TYPES.has(data.mimetype)) {
    return reply.code(400).send({ error: 'Only JPEG, PNG, WebP and GIF images are allowed' });
  }

  const ext      = extname(data.filename) || '.jpg';
  const filename = `${req.user.id}-${randomUUID()}${ext}`;
  const dir      = avatarsDir();
  const dest     = join(dir, filename);

  try {
    await pipeline(data.file, createWriteStream(dest));
  } catch {
    return reply.code(500).send({ error: 'Upload failed' });
  }

  const avatarUrl = `/uploads/avatars/${filename}`;
  const res = await query(
    'UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING avatar_url',
    [avatarUrl, req.user.id],
  );

  broadcast('AVATAR_UPDATED', { userId: req.user.id, avatarUrl });
  return { avatarUrl: res.rows[0].avatar_url };
}

// ── Mission count helper ──────────────────────────────────────────────────────
async function getMissionCounts(userId) {
  const res = await query(
    `SELECT
       COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE m.status = 'OPEN')   AS active
     FROM mission_participants mp
     JOIN missions m ON m.id = mp.mission_id
     WHERE mp.user_id = $1`,
    [userId],
  );
  return {
    totalMissions:  Number(res.rows[0]?.total  ?? 0),
    activeMissions: Number(res.rows[0]?.active ?? 0),
  };
}

export async function profileRoutes(fastify) {

  fastify.get('/me/characters', async (req) => {
    const res = await query(
      `SELECT *
       FROM player_characters
       WHERE user_id = $1 AND active = TRUE AND retired = FALSE
       ORDER BY updated_at DESC`,
      [req.user.id],
    );
    return res.rows.map(r => serializeChar(r));
  });

  fastify.get('/me/characters/available', async (req) => {
    const res = await query(
      `SELECT pc.*, COALESCE(u.display_name, u.name) AS user_display_name
       FROM player_characters pc
       LEFT JOIN users u ON u.id = pc.user_id
       WHERE pc.active = TRUE
         AND pc.retired = FALSE
         AND COALESCE(pc.dead, FALSE) = FALSE
         AND (pc.user_id IS NULL OR pc.user_id = $1)
       ORDER BY pc.name ASC`,
      [req.user.id],
    );

    return res.rows.map(r => ({
      ...serializeChar(r),
      isLinked: Boolean(r.user_id),
      userId: r.user_id ?? null,
      userDisplayName: r.user_display_name ?? null,
    }));
  });

  fastify.post('/me/characters/:id/link', async (req, reply) => {
    const { id } = req.params;
    const existing = await query('SELECT * FROM player_characters WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Personagem não encontrado' });

    const char = existing.rows[0];
    if (char.retired) return reply.code(400).send({ error: 'Personagem aposentado não pode ser vinculado' });
    if (char.dead) return reply.code(400).send({ error: 'Personagem morto não pode ser vinculado' });
    if (char.user_id && char.user_id !== req.user.id) {
      return reply.code(400).send({ error: 'Personagem já vinculado a outro jogador' });
    }

    const res = await query(
      `UPDATE player_characters
       SET user_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, id],
    );

    const linked = serializeChar(res.rows[0]);
    broadcast('CHARACTER_UPDATED', { userId: req.user.id, character: linked });
    return linked;
  });

  fastify.delete('/me/characters/:id/link', async (req, reply) => {
    const { id } = req.params;
    const existing = await query('SELECT * FROM player_characters WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Personagem não encontrado' });

    const char = existing.rows[0];
    if (char.user_id !== req.user.id) {
      return reply.code(403).send({ error: 'Você não tem permissão para desvincular este personagem' });
    }

    const res = await query(
      `UPDATE player_characters
       SET user_id = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id],
    );

    const unlinked = serializeChar(res.rows[0]);
    broadcast('CHARACTER_UPDATED', { userId: req.user.id, character: unlinked });
    return unlinked;
  });

  // ── GET /players  (GM_PRINCIPAL only) ─────────────────────────────────────
  // Lista todos os usuários com seus personagens ativos resumidos.
  // Usado pelo GM_PRINCIPAL para ter visão geral de todos os jogadores.
  fastify.get('/players', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;

    const usersRes = await query(
      `SELECT u.id,
              COALESCE(u.display_name, u.name) AS display_name,
              u.role,
              u.avatar_url,
              u.created_at,
              COUNT(DISTINCT mp.mission_id) FILTER (WHERE mp.mission_id IS NOT NULL) AS total_missions
       FROM users u
       LEFT JOIN mission_participants mp ON mp.user_id = u.id
       GROUP BY u.id
       ORDER BY u.role DESC, u.display_name ASC`,
      [],
    );

    // Busca todos os personagens ativos de uma vez (evita N+1)
    const charsRes = await query(
      `SELECT id, user_id, name, level, class, race, active, retired,
              COALESCE(dead, FALSE) AS dead, token_img_url, foundry_actor_id
       FROM player_characters
       WHERE active = TRUE AND retired = FALSE AND COALESCE(dead, FALSE) = FALSE
       ORDER BY name ASC`,
      [],
    );

    // Agrupa personagens por user_id
    const charsByUser = {};
    for (const c of charsRes.rows) {
      if (!charsByUser[c.user_id]) charsByUser[c.user_id] = [];
      charsByUser[c.user_id].push({
        id:             c.id,
        name:           c.name,
        level:          c.level ?? null,
        class:          c.class ?? null,
        race:           c.race  ?? null,
        tokenImgUrl:    c.token_img_url ?? null,
        foundryActorId: c.foundry_actor_id ?? null,
      });
    }

    return usersRes.rows.map(u => ({
      id:           u.id,
      displayName:  u.display_name,
      role:         u.role,
      avatarUrl:    u.avatar_url ?? null,
      createdAt:    u.created_at,
      totalMissions: parseInt(u.total_missions) || 0,
      characters:   charsByUser[u.id] ?? [],
    }));
  });

  // ── GET /players/:userId/profile ───────────────────────────────────────────
  fastify.get('/players/:userId/profile', async (req, reply) => {
    const { userId } = req.params;

    const userRes = await query(
      `SELECT id, COALESCE(display_name, name) AS display_name, role, avatar_url, created_at
       FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRes.rows.length) return reply.code(404).send({ error: 'User not found' });
    const u = userRes.rows[0];

    const charRes = await query(
      `SELECT * FROM player_characters WHERE user_id = $1 ORDER BY active DESC, updated_at DESC`,
      [userId],
    );

    const stats = await getMissionCounts(userId);

    // Mission count per character — one query
    const charIds = charRes.rows.map(r => r.id);
    let charMissionCounts = {};
    if (charIds.length) {
      // Characters aren't directly linked to missions in the current schema —
      // we count by user participation for now (can be refined when char is
      // linked to mission_participants in a future migration).
      charMissionCounts = Object.fromEntries(charIds.map(id => [id, stats.totalMissions]));
    }

    return {
      user: {
        id:          u.id,
        displayName: u.display_name,
        role:        u.role,
        avatarUrl:   u.avatar_url ?? null,
        createdAt:    u.created_at,
      },
      characters: charRes.rows.map(r => serializeChar(r, charMissionCounts[r.id] ?? 0)),
      stats,
    };
  });

  // ── GET /players/:userId/characters ───────────────────────────────────────
  fastify.get('/players/:userId/characters', async (req, reply) => {
    const { userId } = req.params;
    const res = await query(
      `SELECT * FROM player_characters WHERE user_id = $1 ORDER BY active DESC, updated_at DESC`,
      [userId],
    );
    return res.rows.map(r => serializeChar(r));
  });

  // ── POST /players/:userId/characters (GM only) ────────────────────────────
  // Manually add a character without Foundry sync (e.g. homebrew or non-synced).
  fastify.post('/players/:userId/characters', {
    schema: {
      body: {
        type: 'object', required: ['name'],
        properties: {
          name:       { type: 'string', minLength: 1, maxLength: 100 },
          level:      { type: 'integer', minimum: 1, maximum: 20 },
          xp:         { type: 'integer', minimum: 0 },
          xpNext:     { type: 'integer', minimum: 1 },
          tokenImg:   { type: 'string' },
          portraitImg:{ type: 'string' },
          biography:  { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const { userId } = req.params;
    const { name, level = 1, xp = 0, xpNext = 300, tokenImg, portraitImg, biography } = req.body;

    const res = await query(
      `INSERT INTO player_characters
         (user_id, name, level, xp, xp_next, token_img, portrait_img, biography)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, name.trim(), level, xp, xpNext, tokenImg ?? null, portraitImg ?? null, biography ?? null],
    );
    return reply.code(201).send(serializeChar(res.rows[0]));
  });

  // ── PATCH /players/:userId/characters/:id ─────────────────────────────────
  // GM: link actor → user, retire, edit stats.
  // Owner: can only edit own character's biography/portrait (not level/xp).
  fastify.patch('/players/:userId/characters/:id', async (req, reply) => {
    const { userId, id } = req.params;
    const canAdmin = isAdmin(req.user);
    const isOwner  = req.user.id === userId;

    if (!canAdmin && !isOwner) return reply.code(403).send({ error: 'Forbidden' });

    const existing = await query('SELECT * FROM player_characters WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Character not found' });

    const updates = [];
    const values  = [];

    const set = (col, val) => { values.push(val); updates.push(`${col} = $${values.length}`); };

    if (canAdmin) {
      // GM can change anything
      if (req.body.userId    !== undefined) set('user_id', req.body.userId);
      if (req.body.level     !== undefined) set('level', req.body.level);
      if (req.body.xp        !== undefined) set('xp', req.body.xp);
      if (req.body.xpNext    !== undefined) set('xp_next', req.body.xpNext);
      if (req.body.name      !== undefined) set('name', req.body.name.trim());
      if (req.body.active    !== undefined) set('active', req.body.active);
      if (req.body.retired   !== undefined) {
        set('retired', req.body.retired);
        if (req.body.retired) set('retired_at', new Date().toISOString());
      }
    }

    // Owner (and GM) can update portrait/biography
    if (req.body.portraitImg !== undefined) set('portrait_img', req.body.portraitImg);
    if (req.body.biography   !== undefined) set('biography', req.body.biography);

    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' });

    values.push(id);
    updates.push('updated_at = NOW()');
    const res = await query(
      `UPDATE player_characters SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    const char = serializeChar(res.rows[0]);
    broadcast('CHARACTER_UPDATED', { userId, character: char });
    return char;
  });

  fastify.patch('/players/:userId/characters/:charId/link', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });
    const { userId, charId } = req.params;

    const res = await query(
      `UPDATE player_characters
       SET user_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [userId, charId],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Character not found' });

    const char = serializeChar(res.rows[0]);
    broadcast('CHARACTER_UPDATED', { userId, character: char });
    return char;
  });

  // ── DELETE /players/:userId/characters/:id (GM only) ─────────────────────
  fastify.delete('/players/:userId/characters/:id', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const res = await query(
      'DELETE FROM player_characters WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' });
    return { deleted: true };
  });

  // ── GET /foundry/actors/unlinked (GM only) ────────────────────────────────
  // Returns all Foundry actors that exist in player_characters but have no user_id.
  fastify.get('/foundry/actors/unlinked', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const res = await query(
      `SELECT * FROM player_characters WHERE user_id IS NULL AND foundry_actor_id IS NOT NULL
       ORDER BY name ASC`,
    );
    return res.rows.map(r => serializeChar(r));
  });

  // ── POST /me/avatar ────────────────────────────────────────────────────────
  // Multipart upload for profile picture.
  fastify.post('/me/avatar', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    if (!ALLOWED_IMG_TYPES.has(data.mimetype)) {
      return reply.code(400).send({ error: 'Only JPEG, PNG, WebP and GIF images are allowed' });
    }

    const ext      = extname(data.filename) || '.jpg';
    const filename = `${req.user.id}-${randomUUID()}${ext}`;
    const dir      = avatarsDir();
    const dest     = join(dir, filename);

    let bytes = 0;
    try {
      await pipeline(
        data.file,
        createWriteStream(dest),
        { signal: AbortSignal.timeout(30_000) },
      );
      bytes = data.file.bytesRead ?? 0;
    } catch (err) {
      return reply.code(500).send({ error: 'Upload failed' });
    }

    if (bytes > MAX_AVATAR_BYTES) {
      // File too large — still saved, remove it
      import('fs').then(fs => fs.unlinkSync(dest)).catch(() => {});
      return reply.code(413).send({ error: 'Image exceeds 4 MB limit' });
    }

    const avatarUrl = `/uploads/avatars/${filename}`;
    const res = await query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING avatar_url',
      [avatarUrl, req.user.id],
    );

    broadcast('AVATAR_UPDATED', { userId: req.user.id, avatarUrl });
    return { avatarUrl: res.rows[0].avatar_url };
  });

  fastify.patch('/me/avatar', uploadAvatar);
}