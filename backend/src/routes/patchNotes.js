/**
 * routes/patchNotes.js
 *
 * Notas de patch e atualização de regras.
 * O GM pode vincular um documento do Homebrewery e/ou fazer upload de arquivo.
 *
 * Rotas:
 *  GET  /patch-notes          — lista publicadas (todos)
 *  GET  /patch-notes/:id      — detalhe (todos)
 *  POST /patch-notes          — cria (GM only) — multipart
 *  PATCH /patch-notes/:id     — edita (GM only)
 *  DELETE /patch-notes/:id    — remove (GM only)
 */

import { createWriteStream, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { isGM, isGMPrincipal, isAdmin, requireGM, requireGMPrincipal, requireAdmin } from '../lib/roles.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const HOMEBREW_ORIGIN   = 'https://homebrewery.naturalcrit.com';
const ALLOWED_HOMEBREW_PATHS = ['/share/', '/source/'];   // /source/ = read-only view
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES     = 20 * 1024 * 1024; // 20 MB

function patchNotesDir() {
  const base = process.env.UPLOADS_DIR || 'uploads';
  const dir  = join(base, 'patch-notes');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Validação do link do Homebrewery ─────────────────────────────────────────
function validateHomebrewUrl(raw) {
  if (!raw) return null;
  let url;
  try { url = new URL(raw.trim()); } catch { return { error: 'URL do Homebrewery inválida' }; }

  if (url.origin !== HOMEBREW_ORIGIN) {
    return { error: `URL deve ser de ${HOMEBREW_ORIGIN}` };
  }
  const validPath = ALLOWED_HOMEBREW_PATHS.some(p => url.pathname.startsWith(p));
  if (!validPath) {
    return { error: 'Use o link de compartilhamento (/share/...) do Homebrewery' };
  }
  // Normaliza para share URL mesmo que venha o /source/
  const shareUrl = url.pathname.startsWith('/source/')
    ? `${HOMEBREW_ORIGIN}/share/${url.pathname.replace('/source/', '')}`
    : url.href;

  return { url: shareUrl };
}

// ── Serializer ────────────────────────────────────────────────────────────────
function serializePatchNote(row) {
  return {
    id:           row.id,
    title:        row.title,
    version:      row.version,
    summary:      row.summary      ?? null,
    homebrewUrl:  row.homebrew_url ?? null,
    fileUrl:      row.file_url     ?? null,
    content:      row.content       ?? null,
    published:    row.published,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    author: {
      id:          row.author_id,
      displayName: row.author_display_name || 'GM',
    },
  };
}

export async function patchNoteRoutes(fastify) {

  // ── GET /patch-notes ────────────────────────────────────────────────────────
  fastify.get('/patch-notes', async () => {
    const res = await query(
      `SELECT pn.*, COALESCE(u.display_name, u.name) AS author_display_name
       FROM patch_notes pn
       JOIN users u ON u.id = pn.author_id
       WHERE pn.published = true
       ORDER BY pn.created_at DESC`,
    );
    return res.rows.map(serializePatchNote);
  });

  // ── GET /patch-notes/all (GM only — inclui não publicadas) ─────────────────
  fastify.get('/patch-notes/all', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });
    const res = await query(
      `SELECT pn.*, COALESCE(u.display_name, u.name) AS author_display_name
       FROM patch_notes pn
       JOIN users u ON u.id = pn.author_id
       ORDER BY pn.created_at DESC`,
    );
    return res.rows.map(serializePatchNote);
  });

  // ── GET /patch-notes/:id ───────────────────────────────────────────────────
  fastify.get('/patch-notes/:id', async (req, reply) => {
    const res = await query(
      `SELECT pn.*, COALESCE(u.display_name, u.name) AS author_display_name
       FROM patch_notes pn
       JOIN users u ON u.id = pn.author_id
       WHERE pn.id = $1`,
      [req.params.id],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' });
    const note = res.rows[0];
    // Jogadores só veem publicadas
    if (!note.published && !isGM(req.user)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return serializePatchNote(note);
  });

  // ── POST /patch-notes (multipart, GM only) ─────────────────────────────────
  // Aceita multipart para suportar upload de arquivo + campos de texto juntos.
  // O campo `homebrew_url` e o arquivo são mutuamente opcionais — mas ao menos
  // um deve estar presente.
  fastify.post('/patch-notes', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    // Lê multipart — campos de texto vêm como fields, arquivo como file
    const parts   = req.parts();
    const fields  = {};
    let fileUrl   = null;

    for await (const part of parts) {
      if (part.file) {
        // ── Arquivo (PDF / imagem) ─────────────────────────────────────
        if (!ALLOWED_FILE_TYPES.has(part.mimetype)) {
          // Drena o stream para evitar vazamento
          part.file.resume();
          return reply.code(400).send({ error: 'Formato de arquivo não suportado (PDF, JPEG, PNG, WebP)' });
        }

        const ext      = extname(part.filename) || '.pdf';
        const filename = `${Date.now()}-${randomUUID()}${ext}`;
        const dir      = patchNotesDir();
        const dest     = join(dir, filename);

        let bytes = 0;
        try {
          await pipeline(part.file, createWriteStream(dest));
          bytes = part.file.bytesRead ?? 0;
        } catch {
          return reply.code(500).send({ error: 'Falha no upload do arquivo' });
        }

        if (bytes > MAX_FILE_BYTES) {
          import('fs').then(fs => fs.unlinkSync(dest)).catch(() => {});
          return reply.code(413).send({ error: 'Arquivo excede 20 MB' });
        }

        fileUrl = `/uploads/patch-notes/${filename}`;
      } else {
        // Campo de texto
        fields[part.fieldname] = part.value;
      }
    }

    // ── Validações de campos obrigatórios ──────────────────────────────
    const { title, version, summary, homebrew_url, published, content } = fields;

    if (!title?.trim()) {
      return reply.code(400).send({ error: 'title é obrigatório' });
    }
    if (!version?.trim()) {
      return reply.code(400).send({ error: 'version é obrigatório' });
    }

    // Valida e normaliza o link do Homebrewery
    let homebrewUrl = null;
    if (homebrew_url?.trim()) {
      const result = validateHomebrewUrl(homebrew_url);
      if (result.error) return reply.code(400).send({ error: result.error });
      homebrewUrl = result.url;
    }

    // Ao menos uma fonte deve estar presente
    if (!homebrewUrl && !fileUrl) {
      return reply.code(400).send({
        error: 'Forneça um link do Homebrewery ou faça upload de um arquivo',
      });
    }

    const isPublished = published !== 'false'; // default true

    // Parse do content JSON (seções estruturadas) — campo opcional
    let contentJson = null;
    if (fields.content?.trim()) {
      try { contentJson = JSON.parse(fields.content); } catch { /* ignora JSON inválido */ }
    }

    const res = await query(
      `INSERT INTO patch_notes
         (author_id, title, version, summary, homebrew_url, file_url, published, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        title.trim(),
        version.trim(),
        summary?.trim() || null,
        homebrewUrl,
        fileUrl,
        isPublished,
        contentJson ? JSON.stringify(contentJson) : null,
      ],
    );

    const full = await query(
      `SELECT pn.*, COALESCE(u.display_name, u.name) AS author_display_name
       FROM patch_notes pn JOIN users u ON u.id = pn.author_id
       WHERE pn.id = $1`,
      [res.rows[0].id],
    );

    const note = serializePatchNote(full.rows[0]);
    if (isPublished) broadcast('PATCH_NOTE_CREATED', note);

    return reply.code(201).send(note);
  });

  // ── PATCH /patch-notes/:id (GM only) ──────────────────────────────────────
  // Edição simples via JSON (sem re-upload de arquivo via PATCH por ora).
  fastify.patch('/patch-notes/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          title:       { type: 'string', minLength: 1, maxLength: 120 },
          version:     { type: 'string', minLength: 1, maxLength: 30 },
          summary:     { type: 'string', maxLength: 500 },
          homebrewUrl: { type: 'string' },
          published:   { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const existing = await query('SELECT * FROM patch_notes WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Not found' });

    const updates = [];
    const values  = [];
    const set     = (col, val) => { values.push(val); updates.push(`${col} = $${values.length}`); };

    if (req.body.title     !== undefined) set('title',     req.body.title.trim());
    if (req.body.version   !== undefined) set('version',   req.body.version.trim());
    if (req.body.summary   !== undefined) set('summary',   req.body.summary?.trim() || null);
    if (req.body.published !== undefined) set('published', req.body.published);

    if (req.body.homebrewUrl !== undefined) {
      if (req.body.homebrewUrl) {
        const result = validateHomebrewUrl(req.body.homebrewUrl);
        if (result.error) return reply.code(400).send({ error: result.error });
        set('homebrew_url', result.url);
      } else {
        set('homebrew_url', null);
      }
    }

    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' });

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const res = await query(
      `UPDATE patch_notes SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    const full = await query(
      `SELECT pn.*, COALESCE(u.display_name, u.name) AS author_display_name
       FROM patch_notes pn JOIN users u ON u.id = pn.author_id
       WHERE pn.id = $1`,
      [res.rows[0].id],
    );

    const note = serializePatchNote(full.rows[0]);
    broadcast('PATCH_NOTE_UPDATED', note);
    return note;
  });

  // ── DELETE /patch-notes/:id (GM only) ─────────────────────────────────────
  fastify.delete('/patch-notes/:id', async (req, reply) => {
    if (!isGM(req.user)) return reply.code(403).send({ error: 'GM only' });

    const res = await query(
      'DELETE FROM patch_notes WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' });

    broadcast('PATCH_NOTE_DELETED', { id: req.params.id });
    return { deleted: true };
  });
}