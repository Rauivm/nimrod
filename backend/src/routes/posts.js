import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';

export async function postRoutes(fastify) {
  // GET /posts - paginated feed
  fastify.get('/posts', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const before = req.query.before; // cursor (ISO date)

    let sql = `
      SELECT p.*, 
             u.name as author_name, u.email as author_email, u.role as author_role,
             EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1) as liked_by_me
      FROM posts p
      JOIN users u ON u.id = p.author_id
    `;
    const params = [req.user.id];

    if (before) {
      params.push(before);
      sql += ` WHERE p.created_at < $${params.length}`;
    }

    sql += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const res = await query(sql, params);
    return res.rows;
  });

  // POST /posts
  fastify.post('/posts', {
    schema: {
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 500 }
        }
      }
    }
  }, async (req, reply) => {
    const { content } = req.body;
    const res = await query(
      `INSERT INTO posts (author_id, content) VALUES ($1, $2)
       RETURNING *, (SELECT name FROM users WHERE id = $1) as author_name`,
      [req.user.id, content]
    );
    const post = { ...res.rows[0], liked_by_me: false };
    broadcast('POST_CREATED', post);
    return reply.code(201).send(post);
  });

  // POST /posts/:id/like - toggle
  fastify.post('/posts/:id/like', async (req, reply) => {
    const { id } = req.params;
    // Try insert; if conflict, delete (toggle)
    const exists = await query(
      'SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    let liked;
    if (exists.rows.length > 0) {
      await query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
      await query('UPDATE posts SET like_count = like_count - 1 WHERE id = $1', [id]);
      liked = false;
    } else {
      await query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)', [id, req.user.id]);
      await query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [id]);
      liked = true;
    }

    const post = await query('SELECT like_count FROM posts WHERE id = $1', [id]);
    broadcast('POST_LIKED', { postId: id, likeCount: post.rows[0]?.like_count, liked });
    return { liked, likeCount: post.rows[0]?.like_count };
  });

  // DELETE /posts/:id
  fastify.delete('/posts/:id', async (req, reply) => {
    const { id } = req.params;
    const res = await query(
      'DELETE FROM posts WHERE id = $1 AND author_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });
    broadcast('POST_DELETED', { postId: id });
    return { deleted: true };
  });
}
