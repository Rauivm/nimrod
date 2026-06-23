import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { notifyPostCreated } from '../services/notifier/notifier.js';
import { assertRateLimit } from '../middleware/rateLimit.js';

const MAX_DEPTH = 3;

function serializePost(row) {
  return {
    id:         row.id,
    content:    row.content,
    parentId:   row.parent_id   ?? null,
    entityType: row.entity_type ?? null,
    entityId:   row.entity_id   ?? null,
    likeCount:  Number(row.like_count ?? 0),
    likedByMe:  row.liked_by_me === true || row.liked_by_me === 't',
    replyCount: Number(row.reply_count ?? 0),
    createdAt:  row.created_at,
    author: {
      id:            row.author_id,
      displayName:   row.author_display_name || row.author_name || 'Aventureiro',
      role:          row.author_role,
      // ── Character fields (null when post was made without a character) ──
      characterId:        row.character_id        ?? null,
      characterName:      row.character_name      ?? null,
      characterLevel:     row.character_level != null ? Number(row.character_level) : null,
      characterTokenImg:  row.character_token_img ?? null,
    },
  };
}

// ── Common SELECT fragment reused in every query ──────────────────────────────
// LEFT JOINs player_characters so posts without a character_id still appear.
const POST_SELECT = `
  SELECT
    p.*,
    COALESCE(u.display_name, u.name) AS author_display_name,
    u.name                           AS author_name,
    u.role                           AS author_role,
    pc.name                          AS character_name,
    pc.level                         AS character_level,
    pc.token_img                     AS character_token_img
`;

export async function postRoutes(fastify) {

  // ── GET /posts ─────────────────────────────────────────────────────────────
  fastify.get('/posts', async (req) => {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const before = req.query.before;

    const params = [req.user.id];
    let where = 'WHERE p.parent_id IS NULL';

    if (before) {
      params.push(before);
      where += ` AND p.created_at < $${params.length}`;
    }

    params.push(limit);
    const res = await query(
      `${POST_SELECT},
              EXISTS(
                SELECT 1 FROM post_likes pl
                WHERE pl.post_id = p.id AND pl.user_id = $1
              )                                AS liked_by_me,
              (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS reply_count
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN player_characters pc ON pc.id = p.character_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.rows.map(serializePost);
  });

  // ── GET /posts/:id/replies ─────────────────────────────────────────────────
  fastify.get('/posts/:id/replies', async (req) => {
    const res = await query(
      `${POST_SELECT},
              EXISTS(
                SELECT 1 FROM post_likes pl
                WHERE pl.post_id = p.id AND pl.user_id = $2
              )                                AS liked_by_me,
              (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS reply_count
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN player_characters pc ON pc.id = p.character_id
       WHERE p.parent_id = $1
       ORDER BY p.created_at ASC`,
      [req.params.id, req.user.id],
    );
    return res.rows.map(serializePost);
  });

  // ── POST /posts ────────────────────────────────────────────────────────────
  fastify.post('/posts', {
    schema: {
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content:     { type: 'string', minLength: 1, maxLength: 500 },
          parentId:    { type: 'string' },
          entityType:  { type: 'string', enum: ['mission', 'poll'] },
          entityId:    { type: 'string' },
          characterId: { type: 'string' },   // ← novo campo opcional
        },
      },
    },
  }, async (req, reply) => {
    if (!assertRateLimit(req, reply, 'posts:create', { limit: 8, windowMs: 60_000 })) return reply;
    const { content, parentId, entityType, entityId, characterId } = req.body;

    // ── Validação do personagem ────────────────────────────────────────────
    // Se characterId foi fornecido, garante que ele pertence ao usuário
    // autenticado e está ativo (não aposentado).
    if (characterId) {
      const charRes = await query(
        `SELECT id FROM player_characters
         WHERE id = $1 AND user_id = $2 AND retired = false`,
        [characterId, req.user.id],
      );
      if (!charRes.rows.length) {
        return reply.code(403).send({
          error: 'Personagem não encontrado ou não pertence ao seu usuário',
        });
      }
    }

    // ── Depth guard — prevent infinite nesting ────────────────────────────
    if (parentId) {
      const depthRes = await query(
        `WITH RECURSIVE tree AS (
           SELECT id, parent_id, 0 AS depth FROM posts WHERE id = $1
           UNION ALL
           SELECT p.id, p.parent_id, t.depth + 1
           FROM posts p JOIN tree t ON t.parent_id = p.id
         )
         SELECT MAX(depth) AS depth FROM tree`,
        [parentId],
      );
      const depth = Number(depthRes.rows[0]?.depth ?? 0);
      if (depth >= MAX_DEPTH) {
        return reply.code(400).send({ error: `Max reply depth (${MAX_DEPTH}) reached` });
      }
    }

    const res = await query(
      `INSERT INTO posts (author_id, content, parent_id, entity_type, entity_id, character_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user.id,
        content.trim(),
        parentId    || null,
        entityType  || null,
        entityId    || null,
        characterId || null,   // ← persiste character_id
      ],
    );

    const full = await query(
      `${POST_SELECT},
              false AS liked_by_me,
              0     AS reply_count
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN player_characters pc ON pc.id = p.character_id
       WHERE p.id = $1`,
      [res.rows[0].id],
    );

    const post = serializePost(full.rows[0]);
    broadcast(parentId ? 'REPLY_CREATED' : 'POST_CREATED', post);

    // Notify Discord for top-level tavern posts only
    if (!parentId && !entityType) {
      notifyPostCreated(post);
    }

    return reply.code(201).send(post);
  });

  // ── POST /posts/:id/like ───────────────────────────────────────────────────
  fastify.post('/posts/:id/like', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'posts:like', { limit: 60, windowMs: 60_000 })) return reply;
    const { id } = req.params;
    const exists = await query(
      'SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [id, req.user.id],
    );

    let liked;
    if (exists.rows.length) {
      await query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
      await query('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [id]);
      liked = false;
    } else {
      await query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
      await query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [id]);
      liked = true;
    }

    const post = await query('SELECT like_count FROM posts WHERE id = $1', [id]);
    const likeCount = Number(post.rows[0]?.like_count ?? 0);
    broadcast('POST_LIKED', { postId: id, likeCount, liked });
    return { liked, likeCount };
  });

  // ── DELETE /posts/:id ──────────────────────────────────────────────────────
  fastify.delete('/posts/:id', async (req, reply) => {
    const res = await query(
      'DELETE FROM posts WHERE id = $1 AND author_id = $2 RETURNING id',
      [req.params.id, req.user.id],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });
    broadcast('POST_DELETED', { postId: req.params.id });
    return { deleted: true };
  });
}