import { query } from '../db/index.js';
import { createWriteStream, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { assertRateLimit } from '../middleware/rateLimit.js';
import { isGM, isGMPrincipal, isAdmin, requireGM, requireGMPrincipal, requireAdmin } from '../lib/roles.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tributes expiram após 3 dias.
 * Esta função calcula o tribute_count real ignorando os expirados.
 */
async function getActiveTributeCount(characterId, table = 'character_tributes', fkCol = 'character_id') {
  const res = await query(
    `SELECT COUNT(*) AS cnt
     FROM ${table}
     WHERE ${fkCol} = $1
       AND created_at > NOW() - INTERVAL '3 days'`,
    [characterId],
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotas legacy (tabela `characters`)
// ─────────────────────────────────────────────────────────────────────────────
export async function cemeteryRoutes(fastify) {

  // GET /cemetery
  fastify.get('/cemetery', async (req) => {
    const limit  = Math.min(parseInt(req.query.limit)  || 30, 60);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const res = await query(
      `SELECT
         c.*,
         u.name AS owner_name,
         -- tribute_count recalculado a partir de tributes não expirados
         (
           SELECT COUNT(*)
           FROM character_tributes ct
           WHERE ct.character_id = c.id
             AND ct.created_at > NOW() - INTERVAL '3 days'
         ) AS tribute_count,
         -- tributed_by_me: só vale se o tribute ainda não expirou
         EXISTS(
           SELECT 1
           FROM character_tributes ct2
           WHERE ct2.character_id = c.id
             AND ct2.user_id = $1
             AND ct2.created_at > NOW() - INTERVAL '3 days'
         ) AS tributed_by_me
       FROM characters c
       LEFT JOIN users u ON u.id = c.owner_id
       ORDER BY (
         SELECT COUNT(*)
         FROM character_tributes ct3
         WHERE ct3.character_id = c.id
           AND ct3.created_at > NOW() - INTERVAL '3 days'
       ) DESC, c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset],
    );
    return res.rows;
  });

  // POST /cemetery - multipart: name, description, image (opcional)
  fastify.post('/cemetery', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'cemetery:create', { limit: 8, windowMs: 60_000 })) return reply;

    let name, description, imageUrl;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'image') {
          const ext      = extname(part.filename) || '.jpg';
          const fileName = `char_${randomUUID()}${ext}`;
          const filePath = join(UPLOADS_DIR, fileName);
          await pipeline(part.file, createWriteStream(filePath));
          imageUrl = `/uploads/${fileName}`;
        } else if (part.type === 'field') {
          if (part.fieldname === 'name')        name        = part.value;
          if (part.fieldname === 'description') description = part.value;
        }
      }
    } else {
      name        = req.body?.name;
      description = req.body?.description;
    }

    if (!name) return reply.code(400).send({ error: 'name is required' });

    const res = await query(
      `INSERT INTO characters (owner_id, name, description, image_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, name, description || null, imageUrl || null],
    );
    return reply.code(201).send(res.rows[0]);
  });

  // POST /cemetery/:id/tribute
  // Lógica: usuário pode prestar respeito novamente após 24 h.
  // Remoção manual não existe — o tribute expira automaticamente em 3 dias.
  fastify.post('/cemetery/:id/tribute', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'cemetery:tribute', { limit: 60, windowMs: 60_000 })) return reply;

    const { id } = req.params;

    const charCheck = await query('SELECT id FROM characters WHERE id = $1', [id]);
    if (!charCheck.rows.length) return reply.code(404).send({ error: 'Character not found' });

    // Verifica se já existe tribute ativo (não expirado) nas últimas 24h
    const recent = await query(
      `SELECT 1 FROM character_tributes
       WHERE character_id = $1
         AND user_id = $2
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [id, req.user.id],
    );

    if (recent.rows.length > 0) {
      return reply.code(429).send({ error: 'Você já prestou respeito recentemente. Aguarde 24h.' });
    }

    // Insere novo tribute (o antigo pode existir mas já expirou para rate-limit)
    // Upsert: se existia, atualiza o timestamp; assim evita duplicata na PK
    await query(
      `INSERT INTO character_tributes (character_id, user_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (character_id, user_id)
       DO UPDATE SET created_at = NOW()`,
      [id, req.user.id],
    );

    // Recalcula o tribute_count com base nos tributes ativos
    const activeCount = await getActiveTributeCount(id, 'character_tributes', 'character_id');

    await query(
      `UPDATE characters
       SET tribute_count = $1,
           last_tribute_at = NOW()
       WHERE id = $2`,
      [activeCount, id],
    );

    const updated = await query(
      `SELECT c.*,
              $1::int AS tribute_count,
              TRUE    AS tributed_by_me
       FROM characters c WHERE c.id = $2`,
      [activeCount, id],
    );
    return updated.rows[0];
  });

  // DELETE /cemetery/:id (owner ou GM)
  fastify.delete('/cemetery/:id', async (req, reply) => {
    const res = await query(
      `DELETE FROM characters WHERE id = $1 AND (owner_id = $2 OR $3 = 'GM') RETURNING id`,
      [req.params.id, req.user.id, req.user.role],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });
    return { deleted: true };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotas player_characters (sincronizados do Foundry)
// ─────────────────────────────────────────────────────────────────────────────
export async function cemeteryCharacterRoutes(fastify) {

  // GET /cemetery/characters
  // CORREÇÃO: pc.user_id (não pc.owner_id — coluna inexistente)
  fastify.get('/cemetery/characters', async (req) => {
    const res = await query(
      `SELECT
         pc.*,
         COALESCE(u.display_name, u.name) AS owner_name,
         -- tribute_count: apenas tributes não expirados
         (
           SELECT COUNT(*)
           FROM player_character_tributes pct
           WHERE pct.player_character_id = pc.id
             AND pct.created_at > NOW() - INTERVAL '3 days'
         ) AS tribute_count_active,
         -- tributed_by_me: só tributes ativos (não expirados)
         EXISTS(
           SELECT 1
           FROM player_character_tributes pct2
           WHERE pct2.player_character_id = pc.id
             AND pct2.user_id = $1
             AND pct2.created_at > NOW() - INTERVAL '3 days'
         ) AS tributed_by_me
       FROM player_characters pc
       LEFT JOIN users u ON u.id = pc.user_id
       WHERE pc.dead = TRUE OR pc.retired = TRUE
       ORDER BY (
         SELECT COUNT(*)
         FROM player_character_tributes pct3
         WHERE pct3.player_character_id = pc.id
           AND pct3.created_at > NOW() - INTERVAL '3 days'
       ) DESC, pc.updated_at DESC`,
      [req.user.id],
    );

    return res.rows.map(r => ({
      id:            r.id,
      foundryActorId: r.foundry_actor_id,
      name:          r.name,
      level:         r.level,
      xp:            r.xp,
      tokenImg:      r.token_img,
      portraitImg:   r.portrait_img,
      imageUrl:      r.image_url ?? null,   // upload manual
      classe:        r.classe,
      race:          r.race,
      retired:       r.retired,
      dead:          r.dead,
      dead_at:       r.dead_at,
      retiredAt:     r.retired_at,
      retireReason:  r.retire_reason,
      origin:        r.origin,
      tribute_count: Number(r.tribute_count_active ?? 0),
      ownerName:     r.owner_name,
      owner_id:      r.user_id,   // CORREÇÃO: user_id → owner_id no payload
      tributed_by_me: r.tributed_by_me,
    }));
  });

  // POST /cemetery/pc/:id/tribute
  // Mesma lógica: cooldown 24h, expiração 3 dias, sem remoção manual
  fastify.post('/cemetery/pc/:id/tribute', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'cemetery:tribute', { limit: 60, windowMs: 60_000 })) {
      return reply;
    }

    const { id } = req.params;

    const char = await query(
      `SELECT id FROM player_characters WHERE id = $1 AND (dead = TRUE OR retired = TRUE)`,
      [id],
    );
    if (!char.rows.length) return reply.code(404).send({ error: 'Character not found' });

    // Rate-limit: não pode repetir em menos de 24h
    const recent = await query(
      `SELECT 1 FROM player_character_tributes
       WHERE player_character_id = $1
         AND user_id = $2
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [id, req.user.id],
    );

    if (recent.rows.length > 0) {
      return reply.code(429).send({ error: 'Você já prestou respeito recentemente. Aguarde 24h.' });
    }

    // Upsert: se existia registro expirado, renova o timestamp
    await query(
      `INSERT INTO player_character_tributes (player_character_id, user_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (player_character_id, user_id)
       DO UPDATE SET created_at = NOW()`,
      [id, req.user.id],
    );

    // Recalcula o tribute_count com tributes ativos
    const activeCount = await getActiveTributeCount(id, 'player_character_tributes', 'player_character_id');

    await query(
      `UPDATE player_characters
       SET tribute_count = $1,
           last_tribute_at = NOW()
       WHERE id = $2`,
      [activeCount, id],
    );

    return {
      id,
      tribute_count:  activeCount,
      tributed_by_me: true,
    };
  });

  // POST /cemetery/pc/:id/upload-image — upload manual de imagem para personagem
  fastify.post('/cemetery/pc/:id/upload-image', async (req, reply) => {
    const { id } = req.params;

    const char = await query('SELECT id, user_id FROM player_characters WHERE id = $1', [id]);
    if (!char.rows.length) return reply.code(404).send({ error: 'Character not found' });

    const isOwner = char.rows[0].user_id === req.user.id;
    const currentUserIsGM = isGM(req.user);
    if (!isOwner && !currentUserIsGM) return reply.code(403).send({ error: 'Forbidden' });

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file' });

    const dir      = join(UPLOADS_DIR, 'chars');
    mkdirSync(dir, { recursive: true });
    const ext      = extname(data.filename) || '.jpg';
    const fileName = `pc_${id}_${randomUUID()}${ext}`;
    const filePath = join(dir, fileName);

    await pipeline(data.file, createWriteStream(filePath));
    const imageUrl = `/uploads/chars/${fileName}`;

    await query('UPDATE player_characters SET image_url = $1 WHERE id = $2', [imageUrl, id]);

    return { imageUrl };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Job de limpeza de tributes expirados (chamado pelo cron ou no startup)
// ─────────────────────────────────────────────────────────────────────────────
export async function cleanExpiredTributes() {
  // Remove tributes com mais de 3 dias e recalcula os contadores
  await query(
    `DELETE FROM character_tributes WHERE created_at < NOW() - INTERVAL '3 days'`,
  );
  await query(
    `DELETE FROM player_character_tributes WHERE created_at < NOW() - INTERVAL '3 days'`,
  );

  // Recalcula tribute_count na tabela characters
  await query(
    `UPDATE characters c
     SET tribute_count = (
       SELECT COUNT(*) FROM character_tributes ct
       WHERE ct.character_id = c.id
         AND ct.created_at > NOW() - INTERVAL '3 days'
     )`,
  );

  // Recalcula tribute_count em player_characters
  await query(
    `UPDATE player_characters pc
     SET tribute_count = (
       SELECT COUNT(*) FROM player_character_tributes pct
       WHERE pct.player_character_id = pc.id
         AND pct.created_at > NOW() - INTERVAL '3 days'
     )`,
  );

  console.log('[cemetery] Expired tributes cleaned and counts recalculated.');
}
