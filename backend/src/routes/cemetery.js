import { query } from '../db/index.js';
import { createWriteStream, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });

export async function cemeteryRoutes(fastify) {
  // GET /cemetery
  fastify.get('/cemetery', async (req) => {
    const res = await query(
      `SELECT c.*, u.name as owner_name,
              EXISTS(SELECT 1 FROM character_tributes ct WHERE ct.character_id = c.id AND ct.user_id = $1) as tributed_by_me
       FROM characters c
       LEFT JOIN users u ON u.id = c.owner_id
       ORDER BY c.tribute_count DESC, c.created_at DESC`,
      [req.user.id]
    );
    return res.rows;
  });

  // POST /cemetery - multipart: name, description, image (optional)
  fastify.post('/cemetery', async (req, reply) => {
    let name, description, imageUrl;

    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'image') {
          const ext = extname(part.filename) || '.jpg';
          const fileName = `char_${randomUUID()}${ext}`;
          const filePath = join(UPLOADS_DIR, fileName);
          await pipeline(part.file, createWriteStream(filePath));
          imageUrl = `/uploads/${fileName}`;
        } else if (part.type === 'field') {
          if (part.fieldname === 'name') name = part.value;
          if (part.fieldname === 'description') description = part.value;
        }
      }
    } else {
      // JSON fallback
      name = req.body?.name;
      description = req.body?.description;
    }

    if (!name) return reply.code(400).send({ error: 'name is required' });

    const res = await query(
      `INSERT INTO characters (owner_id, name, description, image_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, name, description || null, imageUrl || null]
    );
    return reply.code(201).send(res.rows[0]);
  });

  // POST /cemetery/:id/tribute
  fastify.post('/cemetery/:id/tribute', async (req, reply) => {
    const { id } = req.params;

    const exists = await query(
      'SELECT 1 FROM character_tributes WHERE character_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (exists.rows.length > 0) {
      await query(
        'DELETE FROM character_tributes WHERE character_id = $1 AND user_id = $2',
        [id, req.user.id]
      );
      await query(
        'UPDATE characters SET tribute_count = GREATEST(tribute_count - 1, 0) WHERE id = $1',
        [id]
      );
    } else {
      const char = await query('SELECT tribute_count FROM characters WHERE id = $1', [id]);
      if (!char.rows.length) return reply.code(404).send({ error: 'Character not found' });

      await query(
        'INSERT INTO character_tributes (character_id, user_id) VALUES ($1, $2)',
        [id, req.user.id]
      );
      await query(
        'UPDATE characters SET tribute_count = tribute_count + 1, last_tribute_at = NOW() WHERE id = $1',
        [id]
      );
    }

    const updated = await query('SELECT * FROM characters WHERE id = $1', [id]);
    return updated.rows[0];
  });

  // DELETE /cemetery/:id (owner or GM)
  fastify.delete('/cemetery/:id', async (req, reply) => {
    const res = await query(
      `DELETE FROM characters WHERE id = $1 AND (owner_id = $2 OR $3 = 'GM') RETURNING id`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });
    return { deleted: true };
  });
}
