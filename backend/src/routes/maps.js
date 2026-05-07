import { query } from '../db/index.js';
import { createWriteStream, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { assertRateLimit } from '../middleware/rateLimit.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });

export async function mapRoutes(fastify) {
  // GET /maps
  fastify.get('/maps', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit) || 30, 60);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const res = await query(
      `SELECT m.*, u.name as uploader_name
       FROM maps m JOIN users u ON u.id = m.uploader_id
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows;
  });

  // POST /maps (GM only)
  fastify.post('/maps', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'maps:upload', { limit: 8, windowMs: 60_000 })) return reply;
    if (req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'GM only' });
    }

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const ext = extname(data.filename);
    const fileId = randomUUID();
    const fileName = `${fileId}${ext}`;
    const filePath = join(UPLOADS_DIR, fileName);

    await pipeline(data.file, createWriteStream(filePath));

    const title = data.fields?.title?.value || data.filename;
    const description = data.fields?.description?.value || '';

    const res = await query(
      `INSERT INTO maps (uploader_id, title, description, file_url, file_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, title, description, `/uploads/${fileName}`, data.filename]
    );
    return reply.code(201).send(res.rows[0]);
  });

  // DELETE /maps/:id (GM only)
  fastify.delete('/maps/:id', async (req, reply) => {
    if (req.user.role !== 'GM') return reply.code(403).send({ error: 'GM only' });
    const res = await query(
      'DELETE FROM maps WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' });
    return { deleted: true };
  });
}
