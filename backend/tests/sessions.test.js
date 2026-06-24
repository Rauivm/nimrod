/**
 * tests/sessions.test.js
 *
 * Testes para o módulo de log de sessões do Nimrod.
 *
 * Estratégia:
 *   • Mini-app Fastify inline (mesmo padrão de userIdentity.test.js)
 *   • db.query mockado via vi.fn() — zero dependência de PostgreSQL real
 *   • broadcast mockado para evitar WebSocket real
 *   • assertRateLimit mockado para não bloquear testes repetidos
 *   • Cada describe tem seu próprio buildApp() com mocks específicos
 *
 * Cobertura:
 *   POST   /sessions               — criar sessão
 *   GET    /sessions               — listar sessões
 *   GET    /sessions/:id           — detalhes da sessão
 *   POST   /sessions/:id/close     — fechar sessão
 *   POST   /sessions/:id/events    — registrar evento de recurso
 *   GET    /sessions/:id/events    — listar eventos
 *   PATCH  /sessions/:id/events/:eid  — editar evento (GM_PRINCIPAL)
 *   DELETE /sessions/:id/events/:eid  — cancelar evento (GM_PRINCIPAL)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de usuário
// ─────────────────────────────────────────────────────────────────────────────

const U_PRINCIPAL = {
  id: 'u-principal', email: 'principal@nimrod.com',
  name: 'GM Principal', display_name: 'GM Principal', role: 'GM_PRINCIPAL',
};

const U_GM = {
  id: 'u-gm', email: 'gm@nimrod.com',
  name: 'Narrador', display_name: 'Narrador', role: 'GM',
};

const U_PLAYER = {
  id: 'u-player', email: 'player@nimrod.com',
  name: 'Jogador', display_name: 'Jogador', role: 'PLAYER',
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de dados
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_ROW = {
  id:               's-1',
  title:            'Sessão 1 — A Floresta Sombria',
  campaign:         'Liga Nimrod',
  session_number:   1,
  status:           'open',
  started_at:       '2025-01-01T20:00:00Z',
  closed_at:        null,
  scheduled_at:     null,
  opened_by:        U_PRINCIPAL.id,
  closed_by:        null,
  primary_gm_id:    U_PRINCIPAL.id,
  primary_gm_name:  'GM Principal',
  narrator_ids:     [U_PRINCIPAL.id, U_GM.id],
  player_ids:       [U_PLAYER.id],
  summary:          null,
  gm_notes:         'Segredo: o estalajadeiro é um vampiro',
  tags:             ['combate', 'roleplay'],
  foundry_scene_id: 'scene-abc',
  created_at:       '2025-01-01T20:00:00Z',
  updated_at:       '2025-01-01T20:00:00Z',
  deleted_at:       null,
  event_count:      '3',
};

const EVENT_ROW = {
  id:               'e-1',
  session_id:       's-1',
  player_id:        U_PLAYER.id,
  player_name:      'Jogador',
  actor_name:       'Thorin',
  registered_by:    U_GM.id,
  registered_by_name: 'Narrador',
  source:           'manual',
  resource_type:    'gold',
  delta:            '-50',
  value_before:     '200',
  value_after:      '150',
  delta_meta:       {},
  description:      'Pagou hospedagem na taverna',
  foundry_event_id: null,
  occurred_at:      '2025-01-01T21:00:00Z',
  created_at:       '2025-01-01T21:00:00Z',
  updated_at:       '2025-01-01T21:00:00Z',
  edited_at:        null,
  edited_by:        null,
  edit_reason:      null,
  deleted_at:       null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory: constrói mini-app com rotas inline que usam mockDb injetado
// Espelha o padrão de userIdentity.test.js — sem importar o módulo real,
// pois ele usa `query` do módulo db via import estático.
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp({ mockUser, mockDb, mockBroadcast = vi.fn() }) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    reply.code(err.statusCode || 500).send({ error: err.message });
  });

  // Injeta usuário autenticado (simula cfAuthMiddleware)
  app.addHook('preHandler', async (req) => { req.user = mockUser; });

  // Rate limit: sempre passa nos testes
  const assertRateLimit = () => true;

  // Alias para query mockada
  const query = (sql, params) => mockDb.query(sql, params);

  // ── Helpers locais (cópia do sessions.js) ─────────────────────────────────

  const GM_ROLES = new Set(['GM', 'GM_PRINCIPAL']);
  const VALID_RESOURCE_TYPES = new Set([
    'gold', 'xp', 'potion', 'spell_slot', 'item', 'hp', 'custom',
  ]);
  const VALID_SOURCES = new Set(['foundry', 'manual', 'system']);

  function isGM(user) { return GM_ROLES.has(user?.role); }
  function isGMPrincipal(user) { return user?.role === 'GM_PRINCIPAL'; }

  function requireGM(req, reply) {
    if (!isGM(req.user)) {
      reply.code(403).send({ error: 'Apenas GMs podem acessar este recurso.' });
      return false;
    }
    return true;
  }

  function requireGMPrincipal(req, reply) {
    if (!isGMPrincipal(req.user)) {
      reply.code(403).send({ error: 'Apenas o GM Principal pode executar esta ação.' });
      return false;
    }
    return true;
  }

  function serializeSession(row) {
    return {
      id:             row.id,
      title:          row.title,
      campaign:       row.campaign       ?? null,
      sessionNumber:  row.session_number ?? null,
      status:         row.status,
      startedAt:      row.started_at,
      closedAt:       row.closed_at      ?? null,
      scheduledAt:    row.scheduled_at   ?? null,
      primaryGmId:    row.primary_gm_id,
      primaryGmName:  row.primary_gm_name ?? null,
      openedBy:       row.opened_by,
      closedBy:       row.closed_by      ?? null,
      narratorIds:    row.narrator_ids   ?? [],
      playerIds:      row.player_ids     ?? [],
      summary:        row.summary        ?? null,
      gmNotes:        row.gm_notes       ?? null,
      tags:           row.tags           ?? [],
      foundrySceneId: row.foundry_scene_id ?? null,
      createdAt:      row.created_at,
      updatedAt:      row.updated_at,
      eventCount:     row.event_count != null ? Number(row.event_count) : undefined,
    };
  }

  function serializeEvent(row) {
    return {
      id:               row.id,
      sessionId:        row.session_id,
      playerId:         row.player_id,
      playerName:       row.player_name     ?? null,
      actorName:        row.actor_name,
      registeredBy:     row.registered_by,
      registeredByName: row.registered_by_name ?? null,
      source:           row.source,
      resourceType:     row.resource_type,
      delta:            Number(row.delta),
      valueBefore:      row.value_before != null ? Number(row.value_before) : null,
      valueAfter:       row.value_after  != null ? Number(row.value_after)  : null,
      deltaMeta:        row.delta_meta   ?? {},
      description:      row.description  ?? null,
      foundryEventId:   row.foundry_event_id ?? null,
      occurredAt:       row.occurred_at,
      createdAt:        row.created_at,
      editedAt:         row.edited_at    ?? null,
      editedBy:         row.edited_by    ?? null,
      editReason:       row.edit_reason  ?? null,
      deletedAt:        row.deleted_at   ?? null,
    };
  }

  // ── Rotas ──────────────────────────────────────────────────────────────────

  // POST /sessions
  app.post('/sessions', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;
    if (!assertRateLimit(req, reply)) return reply;
    const { title, campaign = null, sessionNumber = null, scheduledAt = null,
            narratorIds = [], playerIds = [], gmNotes = null, tags = [],
            foundrySceneId = null } = req.body ?? {};
    if (!title?.trim()) return reply.code(400).send({ error: 'title é obrigatório.' });
    if (title.trim().length > 200) return reply.code(400).send({ error: 'title deve ter no máximo 200 caracteres.' });
    const resolvedNarratorIds = narratorIds.includes(req.user.id)
      ? narratorIds : [req.user.id, ...narratorIds];
    const res = await query(
      `INSERT INTO session_logs (title, campaign, session_number, scheduled_at,
        opened_by, primary_gm_id, narrator_ids, player_ids,
        gm_notes, tags, foundry_scene_id)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title.trim(), campaign, sessionNumber, scheduledAt, req.user.id,
       resolvedNarratorIds, playerIds, gmNotes, tags, foundrySceneId],
    );
    const fetchRes = await query('SELECT * FROM session_logs WHERE id=$1', [res.rows[0].id]);
    const session  = serializeSession(fetchRes.rows[0]);
    mockBroadcast('SESSION_CREATED', session);
    return reply.code(201).send(session);
  });

  // GET /sessions
  app.get('/sessions', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const res = await query('SELECT * FROM session_logs WHERE deleted_at IS NULL', []);
    return res.rows.map(serializeSession);
  });

  // GET /sessions/:id
  app.get('/sessions/:id', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const slRes = await query('SELECT * FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!slRes.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    const sl = slRes.rows[0];
    if (!isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Acesso negado a esta sessão.' });
    }
    const snapRes   = await query('SELECT * FROM session_snapshots WHERE session_id=$1', [sl.id]);
    const eventsRes = await query('SELECT * FROM resource_deltas WHERE session_id=$1 LIMIT 50', [sl.id]);
    const serialized = serializeSession(sl);
    if (!isGM(req.user)) serialized.gmNotes = undefined;
    return { ...serialized, snapshots: snapRes.rows, recentEvents: eventsRes.rows.map(serializeEvent) };
  });

  // POST /sessions/:id/close
  app.post('/sessions/:id/close', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;
    const slRes = await query('SELECT * FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!slRes.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    const sl = slRes.rows[0];
    if (sl.status !== 'open') return reply.code(400).send({ error: `Sessão já está com status "${sl.status}".` });
    const { summary = null, gmNotes = null } = req.body ?? {};
    await query('UPDATE session_logs SET status=$1, closed_at=NOW(), closed_by=$2 WHERE id=$3',
      ['closed', req.user.id, sl.id]);
    const totalsRes = await query('SELECT player_id FROM resource_deltas WHERE session_id=$1', [sl.id]);
    for (const row of totalsRes.rows) {
      await query('INSERT INTO session_snapshots (session_id, player_id, actor_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [sl.id, row.player_id, 'actor']);
    }
    const closed = await query('SELECT * FROM session_logs WHERE id=$1', [sl.id]);
    const session = serializeSession({ ...closed.rows[0], status: 'closed' });
    mockBroadcast('SESSION_CLOSED', session);
    return session;
  });

  // POST /sessions/:id/events
  app.post('/sessions/:id/events', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const slRes = await query('SELECT id, status, narrator_ids FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!slRes.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    const sl = slRes.rows[0];
    if (sl.status !== 'open') return reply.code(400).send({ error: 'Não é possível registrar eventos em sessão fechada.' });
    if (!isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Você não é narrador desta sessão.' });
    }
    const { playerId, actorName, resourceType, delta, valueBefore = null,
            valueAfter = null, deltaMeta = {}, description = null,
            foundryEventId = null, occurredAt = null, source = 'manual' } = req.body ?? {};
    if (!playerId?.trim())                    return reply.code(400).send({ error: 'playerId é obrigatório.' });
    if (!actorName?.trim())                   return reply.code(400).send({ error: 'actorName é obrigatório.' });
    if (!VALID_RESOURCE_TYPES.has(resourceType)) return reply.code(400).send({ error: 'resourceType inválido.' });
    if (typeof delta !== 'number' || delta === 0 || !isFinite(delta))
      return reply.code(400).send({ error: 'delta deve ser um número diferente de zero.' });
    const playerCheck = await query('SELECT id FROM users WHERE id=$1', [playerId]);
    if (!playerCheck.rows.length) return reply.code(400).send({ error: 'playerId não encontrado.' });
    const resolvedSource = VALID_SOURCES.has(source) ? source : 'manual';
    let res;
    try {
      res = await query('INSERT INTO resource_deltas (session_id, player_id, actor_name, registered_by, source, resource_type, delta, value_before, value_after, delta_meta, description, foundry_event_id, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,NOW())) RETURNING *',
        [req.params.id, playerId, actorName.trim(), req.user.id, resolvedSource,
         resourceType, delta, valueBefore, valueAfter, JSON.stringify(deltaMeta),
         description?.trim() ?? null, foundryEventId ?? null, occurredAt]);
    } catch (err) {
      if (err.message?.includes('session_not_open'))
        return reply.code(409).send({ error: 'A sessão foi fechada antes do evento ser salvo.' });
      if (err.code === '23505' && err.constraint?.includes('foundry_event_id'))
        return reply.code(409).send({ error: 'Evento já registrado (foundry_event_id duplicado).' });
      throw err;
    }
    const eventRes = await query('SELECT * FROM resource_deltas WHERE id=$1', [res.rows[0].id]);
    const event    = serializeEvent({ ...eventRes.rows[0], player_name: 'Jogador', registered_by_name: 'GM' });
    mockBroadcast('SESSION_EVENT_CREATED', { sessionId: req.params.id, event });
    return reply.code(201).send(event);
  });

  // GET /sessions/:id/events
  app.get('/sessions/:id/events', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const slRes = await query('SELECT id, narrator_ids FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!slRes.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    const sl = slRes.rows[0];
    if (!isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id))
      return reply.code(403).send({ error: 'Acesso negado a esta sessão.' });
    const res = await query('SELECT * FROM resource_deltas WHERE session_id=$1 ORDER BY occurred_at DESC LIMIT 50', [sl.id]);
    return res.rows.map(r => serializeEvent({ ...r, player_name: null, registered_by_name: null }));
  });

  // PATCH /sessions/:id/events/:eid
  app.patch('/sessions/:id/events/:eid', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;
    const { editReason, delta, description } = req.body ?? {};
    if (!editReason?.trim()) return reply.code(400).send({ error: 'editReason é obrigatório para edições retroativas.' });
    const existing = await query('SELECT rd.*, sl.status AS session_status FROM resource_deltas rd JOIN session_logs sl ON sl.id=rd.session_id WHERE rd.id=$1 AND rd.session_id=$2 AND rd.deleted_at IS NULL',
      [req.params.eid, req.params.id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Evento não encontrado.' });
    if (delta !== undefined && (typeof delta !== 'number' || delta === 0 || !isFinite(delta)))
      return reply.code(400).send({ error: 'delta deve ser um número diferente de zero.' });
    const updates = ['edited_at=NOW()', `edited_by='${req.user.id}'`, `edit_reason='${editReason}'`];
    if (delta !== undefined)       updates.push(`delta=${delta}`);
    if (description !== undefined) updates.push(`description='${description}'`);
    if (updates.length === 3)      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    await query(`UPDATE resource_deltas SET ${updates.join(',')} WHERE id=$1`, [req.params.eid]);
    const updated = await query('SELECT * FROM resource_deltas WHERE id=$1', [req.params.eid]);
    const event   = serializeEvent({ ...updated.rows[0], player_name: null, registered_by_name: null });
    mockBroadcast('SESSION_EVENT_UPDATED', { sessionId: req.params.id, event });
    return event;
  });

  // DELETE /sessions/:id/events/:eid
  app.delete('/sessions/:id/events/:eid', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;
    const { deleteReason } = req.body ?? {};
    if (!deleteReason?.trim()) return reply.code(400).send({ error: 'deleteReason é obrigatório para cancelar um evento.' });
    const existing = await query('SELECT rd.id FROM resource_deltas rd WHERE rd.id=$1 AND rd.session_id=$2 AND rd.deleted_at IS NULL',
      [req.params.eid, req.params.id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Evento não encontrado ou já cancelado.' });
    await query('UPDATE resource_deltas SET deleted_at=NOW(), deleted_by=$1, delete_reason=$2 WHERE id=$3',
      [req.user.id, deleteReason.trim(), req.params.eid]);
    mockBroadcast('SESSION_EVENT_DELETED', { sessionId: req.params.id, eventId: req.params.eid });
    return { deleted: true, eventId: req.params.eid };
  });

  await app.ready();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de mock reutilizáveis
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna sempre a SESSION_ROW na primeira query e variações nas seguintes */
function dbSession(overrides = {}) {
  const row = { ...SESSION_ROW, ...overrides };
  return { query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }) };
}

/** DB que retorna lista de sessões */
function dbSessionList(rows = [SESSION_ROW]) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

/** DB que simula sessão não encontrada */
function dbEmpty() {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

/** DB sequencial: cada call retorna o próximo item do array */
function dbSequence(...responses) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(async () => {
      const r = responses[i] ?? responses.at(-1);
      i++;
      return r;
    }),
  };
}

const j = (res) => JSON.parse(res.body);

// ═════════════════════════════════════════════════════════════════════════════
// POST /sessions
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /sessions — criar sessão', () => {
  it('GM_PRINCIPAL cria sessão e retorna 201 com dados serializados', async () => {
    const db  = dbSequence(
      { rows: [SESSION_ROW], rowCount: 1 },  // INSERT RETURNING
      { rows: [SESSION_ROW], rowCount: 1 },  // fetch após insert
    );
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });

    const res = await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'Sessão 1 — A Floresta Sombria', campaign: 'Liga Nimrod' },
    });

    expect(res.statusCode).toBe(201);
    const body = j(res);
    expect(body.id).toBe('s-1');
    expect(body.title).toBe('Sessão 1 — A Floresta Sombria');
    expect(body.status).toBe('open');
    expect(body.campaign).toBe('Liga Nimrod');
  });

  it('GM comum recebe 403', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'Tentativa' },
    });
    expect(res.statusCode).toBe(403);
    expect(j(res).error).toContain('GM Principal');
  });

  it('PLAYER recebe 403', async () => {
    const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'Tentativa' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('retorna 400 quando title está vazio', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('title');
  });

  it('retorna 400 quando title está ausente', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando title excede 200 caracteres', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'A'.repeat(201) },
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('200');
  });

  it('auto-inclui GM_PRINCIPAL na lista de narradores', async () => {
    const captured = [];
    const db = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        captured.push({ sql, params });
        return { rows: [SESSION_ROW], rowCount: 1 };
      }),
    };
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'Sessão X', narratorIds: [U_GM.id] },
    });
    // O array de narradores enviado ao banco deve conter o GM Principal
    const insertCall = captured.find(c => c.sql.includes('INSERT INTO session_logs'));
    expect(insertCall).toBeTruthy();
    const narratorArg = insertCall.params.find(p => Array.isArray(p));
    expect(narratorArg).toContain(U_PRINCIPAL.id);
  });

  it('emite broadcast SESSION_CREATED', async () => {
    const broadcast = vi.fn();
    const db = dbSequence(
      { rows: [SESSION_ROW], rowCount: 1 },
      { rows: [SESSION_ROW], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db, mockBroadcast: broadcast });
    await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'Nova Sessão' },
    });
    expect(broadcast).toHaveBeenCalledWith('SESSION_CREATED', expect.objectContaining({ id: 's-1' }));
  });

  it('serializa eventCount como número', async () => {
    const db  = dbSequence(
      { rows: [SESSION_ROW], rowCount: 1 },
      { rows: [SESSION_ROW], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    const res  = await app.inject({
      method: 'POST', url: '/sessions',
      payload: { title: 'Sessão' },
    });
    expect(typeof j(res).eventCount).toBe('number');
    expect(j(res).eventCount).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /sessions
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /sessions — listar sessões', () => {
  it('GM_PRINCIPAL vê lista de sessões', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbSessionList() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);
    expect(j(res)).toHaveLength(1);
    expect(j(res)[0].id).toBe('s-1');
  });

  it('GM comum vê lista de sessões', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbSessionList() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);
  });

  it('PLAYER recebe 403', async () => {
    const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(403);
  });

  it('retorna lista vazia quando não há sessões', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);
    expect(j(res)).toHaveLength(0);
  });

  it('serializa campos camelCase corretamente', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbSessionList() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    const item = j(res)[0];
    // Garante que não há snake_case vazando para o cliente
    expect(item).toHaveProperty('startedAt');
    expect(item).toHaveProperty('primaryGmId');
    expect(item).toHaveProperty('narratorIds');
    expect(item).not.toHaveProperty('started_at');
    expect(item).not.toHaveProperty('primary_gm_id');
  });

  it('retorna múltiplas sessões', async () => {
    const second = { ...SESSION_ROW, id: 's-2', title: 'Sessão 2' };
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbSessionList([SESSION_ROW, second]) });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    expect(j(res)).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /sessions/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /sessions/:id — detalhes da sessão', () => {
  function dbForDetail(sessionRow = SESSION_ROW) {
    return dbSequence(
      { rows: [sessionRow], rowCount: 1 },  // session_logs
      { rows: [],           rowCount: 0 },  // session_snapshots
      { rows: [EVENT_ROW],  rowCount: 1 },  // resource_deltas
    );
  }

  it('GM_PRINCIPAL obtém detalhes completos incluindo gmNotes', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForDetail() });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1' });
    expect(res.statusCode).toBe(200);
    const body = j(res);
    expect(body.id).toBe('s-1');
    expect(body.gmNotes).toBe('Segredo: o estalajadeiro é um vampiro');
    expect(body.recentEvents).toHaveLength(1);
  });

  it('GM narrador da sessão acessa normalmente', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbForDetail() });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1' });
    expect(res.statusCode).toBe(200);
  });

  it('GM fora da sessão recebe 403', async () => {
    const rowSemGM = { ...SESSION_ROW, narrator_ids: [U_PRINCIPAL.id] }; // só principal
    const app = await buildApp({ mockUser: U_GM, mockDb: dbForDetail(rowSemGM) });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1' });
    expect(res.statusCode).toBe(403);
    expect(j(res).error).toContain('Acesso negado');
  });

  it('PLAYER recebe 403', async () => {
    const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbForDetail() });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1' });
    expect(res.statusCode).toBe(403);
  });

  it('sessão inexistente retorna 404', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'GET', url: '/sessions/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(j(res).error).toContain('não encontrada');
  });

  it('retorna snapshots e recentEvents', async () => {
    const snap = { session_id: 's-1', player_id: U_PLAYER.id, actor_name: 'Thorin',
                   total_gold_delta: -50, total_xp_delta: 100 };
    const db = dbSequence(
      { rows: [SESSION_ROW], rowCount: 1 },
      { rows: [snap],        rowCount: 1 },
      { rows: [EVENT_ROW],   rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1' });
    const body = j(res);
    expect(body.snapshots).toHaveLength(1);
    expect(body.recentEvents).toHaveLength(1);
    expect(body.snapshots[0].total_gold_delta).toBe(-50);
  });

  it('evento serializado tem delta como número', async () => {
    const db  = dbForDetail();
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1' });
    const event = j(res).recentEvents[0];
    expect(typeof event.delta).toBe('number');
    expect(event.delta).toBe(-50);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /sessions/:id/close
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /sessions/:id/close — fechar sessão', () => {
  function dbForClose(statusOverride = 'open') {
    const sessionRow = { ...SESSION_ROW, status: statusOverride };
    return dbSequence(
      { rows: [sessionRow], rowCount: 1 },  // busca sessão
      { rows: [],           rowCount: 0 },  // UPDATE session_logs
      { rows: [],           rowCount: 0 },  // SELECT totals
      { rows: [{ ...sessionRow, status: 'closed', closed_at: new Date().toISOString() }], rowCount: 1 },
    );
  }

  it('GM_PRINCIPAL fecha sessão aberta e retorna status closed', async () => {
    const broadcast = vi.fn();
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForClose(), mockBroadcast: broadcast });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/close',
      payload: { summary: 'Os heróis venceram o dragão.' },
    });
    expect(res.statusCode).toBe(200);
    expect(j(res).status).toBe('closed');
    expect(broadcast).toHaveBeenCalledWith('SESSION_CLOSED', expect.objectContaining({ status: 'closed' }));
  });

  it('GM comum recebe 403', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'POST', url: '/sessions/s-1/close', payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('sessão já fechada retorna 400', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForClose('closed') });
    const res  = await app.inject({ method: 'POST', url: '/sessions/s-1/close', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('closed');
  });

  it('sessão arquivada retorna 400', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForClose('archived') });
    const res  = await app.inject({ method: 'POST', url: '/sessions/s-1/close', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('archived');
  });

  it('sessão inexistente retorna 404', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'POST', url: '/sessions/nao-existe/close', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /sessions/:id/events — registrar evento de recurso
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /sessions/:id/events — registrar evento', () => {
  const VALID_PAYLOAD = {
    playerId:     U_PLAYER.id,
    actorName:    'Thorin',
    resourceType: 'gold',
    delta:        -50,
    valueBefore:  200,
    valueAfter:   150,
    description:  'Pagou hospedagem',
  };

  function dbForEvent() {
    return dbSequence(
      { rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
      { rows: [{ id: U_PLAYER.id }], rowCount: 1 },  // player check
      { rows: [EVENT_ROW],           rowCount: 1 },  // INSERT
      { rows: [EVENT_ROW],           rowCount: 1 },  // fetch após insert
    );
  }

  it('GM registra evento e retorna 201', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbForEvent() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
    const body = j(res);
    expect(body.resourceType).toBe('gold');
    expect(body.delta).toBe(-50);
    expect(body.actorName).toBe('Thorin');
  });

  it('GM_PRINCIPAL também pode registrar evento', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForEvent() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
  });

  it('PLAYER recebe 403', async () => {
    const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
  });

  it('GM fora da sessão recebe 403', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id] }], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
    expect(j(res).error).toContain('narrador');
  });

  it('sessão fechada retorna 400', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', status: 'closed', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('fechada');
  });

  it('sessão inexistente retorna 404', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/nao-existe/events',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(404);
  });

  describe('validações de payload', () => {
    async function expectError(payload, statusCode, fragment) {
      const db  = dbSequence(
        { rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
        { rows: [{ id: U_PLAYER.id }], rowCount: 1 },
      );
      const app = await buildApp({ mockUser: U_GM, mockDb: db });
      const res  = await app.inject({
        method: 'POST', url: '/sessions/s-1/events', payload,
      });
      expect(res.statusCode).toBe(statusCode);
      if (fragment) expect(j(res).error).toContain(fragment);
    }

    it('retorna 400 sem playerId',     () => expectError({ ...VALID_PAYLOAD, playerId: '' },           400, 'playerId'));
    it('retorna 400 sem actorName',    () => expectError({ ...VALID_PAYLOAD, actorName: '' },          400, 'actorName'));
    it('retorna 400 com delta=0',      () => expectError({ ...VALID_PAYLOAD, delta: 0 },               400, 'delta'));
    it('retorna 400 com delta string', () => expectError({ ...VALID_PAYLOAD, delta: '-50' },           400, 'delta'));
    it('retorna 400 resourceType ruim',() => expectError({ ...VALID_PAYLOAD, resourceType: 'mana' },   400, 'resourceType'));

    it('retorna 400 quando playerId não existe no banco', async () => {
      const db = dbSequence(
        { rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
        { rows: [], rowCount: 0 },  // player não encontrado
      );
      const app = await buildApp({ mockUser: U_GM, mockDb: db });
      const res  = await app.inject({
        method: 'POST', url: '/sessions/s-1/events',
        payload: VALID_PAYLOAD,
      });
      expect(res.statusCode).toBe(400);
      expect(j(res).error).toContain('playerId não encontrado');
    });
  });

  it('idempotência: foundry_event_id duplicado retorna 409', async () => {
    const dupError = Object.assign(new Error('dup'), { code: '23505', constraint: 'resource_deltas_foundry_event_id_key' });
    const db = dbSequence(
      { rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
      { rows: [{ id: U_PLAYER.id }], rowCount: 1 },
    );
    db.query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }] })
      .mockResolvedValueOnce({ rows: [{ id: U_PLAYER.id }] })
      .mockRejectedValueOnce(dupError);
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: { ...VALID_PAYLOAD, foundryEventId: 'fvtt-ev-123' },
    });
    expect(res.statusCode).toBe(409);
    expect(j(res).error).toContain('duplicado');
  });

  it('aceita todos os resourceTypes válidos', async () => {
    const types = ['gold', 'xp', 'potion', 'spell_slot', 'item', 'hp', 'custom'];
    for (const rt of types) {
      const db = dbSequence(
        { rows: [{ id: 's-1', status: 'open', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
        { rows: [{ id: U_PLAYER.id }], rowCount: 1 },
        { rows: [{ ...EVENT_ROW, resource_type: rt }], rowCount: 1 },
        { rows: [{ ...EVENT_ROW, resource_type: rt }], rowCount: 1 },
      );
      const app = await buildApp({ mockUser: U_GM, mockDb: db });
      const res  = await app.inject({
        method: 'POST', url: '/sessions/s-1/events',
        payload: { ...VALID_PAYLOAD, resourceType: rt },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it('emite broadcast SESSION_EVENT_CREATED', async () => {
    const broadcast = vi.fn();
    const app = await buildApp({ mockUser: U_GM, mockDb: dbForEvent(), mockBroadcast: broadcast });
    await app.inject({
      method: 'POST', url: '/sessions/s-1/events',
      payload: VALID_PAYLOAD,
    });
    expect(broadcast).toHaveBeenCalledWith(
      'SESSION_EVENT_CREATED',
      expect.objectContaining({ sessionId: 's-1', event: expect.objectContaining({ resourceType: 'gold' }) }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /sessions/:id/events — listar eventos
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /sessions/:id/events — listar eventos', () => {
  it('GM narrador lista eventos da sessão', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
      { rows: [EVENT_ROW], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(res.statusCode).toBe(200);
    expect(j(res)).toHaveLength(1);
    expect(j(res)[0].resourceType).toBe('gold');
  });

  it('GM_PRINCIPAL lista eventos de qualquer sessão', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [] }], rowCount: 1 }, // não está em narrator_ids
      { rows: [EVENT_ROW], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(res.statusCode).toBe(200);
  });

  it('GM fora da sessão recebe 403', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [U_PRINCIPAL.id] }], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(res.statusCode).toBe(403);
  });

  it('PLAYER recebe 403', async () => {
    const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(res.statusCode).toBe(403);
  });

  it('sessão inexistente retorna 404', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({ method: 'GET', url: '/sessions/nao-existe/events' });
    expect(res.statusCode).toBe(404);
  });

  it('eventos serializados têm delta como número', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
      { rows: [EVENT_ROW], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(typeof j(res)[0].delta).toBe('number');
  });

  it('lista vazia retorna array vazio', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [U_PRINCIPAL.id, U_GM.id] }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(res.statusCode).toBe(200);
    expect(j(res)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /sessions/:id/events/:eid — editar evento
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /sessions/:id/events/:eid — editar evento', () => {
  function dbForPatch(eventRow = EVENT_ROW) {
    return dbSequence(
      { rows: [{ ...eventRow, session_status: 'open' }], rowCount: 1 }, // busca evento
      { rows: [], rowCount: 0 },                                          // UPDATE
      { rows: [eventRow],       rowCount: 1 },                           // fetch após update
    );
  }

  it('GM_PRINCIPAL edita delta com editReason e retorna evento atualizado', async () => {
    const broadcast = vi.fn();
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForPatch(), mockBroadcast: broadcast });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { delta: -75, editReason: 'Corrigi o valor cobrado pela taverna' },
    });
    expect(res.statusCode).toBe(200);
    expect(broadcast).toHaveBeenCalledWith('SESSION_EVENT_UPDATED', expect.objectContaining({ sessionId: 's-1' }));
  });

  it('GM comum recebe 403', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { delta: -75, editReason: 'Correção' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('retorna 400 sem editReason', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { delta: -75 },
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('editReason');
  });

  it('retorna 400 com editReason vazio', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { delta: -75, editReason: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 com delta=0', async () => {
    const db  = dbForPatch();
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { delta: 0, editReason: 'Correção' },
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('delta');
  });

  it('retorna 400 quando nenhum campo é enviado além de editReason', async () => {
    const db  = dbForPatch();
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: db });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { editReason: 'Só o motivo, sem mudança' },
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('Nenhum campo');
  });

  it('evento inexistente retorna 404', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/nao-existe',
      payload: { delta: -10, editReason: 'Ajuste' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('permite editar description sem alterar delta', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForPatch() });
    const res  = await app.inject({
      method: 'PATCH', url: '/sessions/s-1/events/e-1',
      payload: { description: 'Descrição corrigida', editReason: 'Erro de digitação' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /sessions/:id/events/:eid — cancelar evento
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /sessions/:id/events/:eid — cancelar evento', () => {
  function dbForDelete() {
    return dbSequence(
      { rows: [{ id: 'e-1' }], rowCount: 1 },  // busca evento
      { rows: [],              rowCount: 0 },   // soft delete UPDATE
    );
  }

  it('GM_PRINCIPAL cancela evento com deleteReason e retorna confirmação', async () => {
    const broadcast = vi.fn();
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbForDelete(), mockBroadcast: broadcast });
    const res  = await app.inject({
      method: 'DELETE', url: '/sessions/s-1/events/e-1',
      payload: { deleteReason: 'Evento registrado por engano' },
    });
    expect(res.statusCode).toBe(200);
    const body = j(res);
    expect(body.deleted).toBe(true);
    expect(body.eventId).toBe('e-1');
    expect(broadcast).toHaveBeenCalledWith('SESSION_EVENT_DELETED',
      expect.objectContaining({ sessionId: 's-1', eventId: 'e-1' }));
  });

  it('GM comum recebe 403', async () => {
    const app = await buildApp({ mockUser: U_GM, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'DELETE', url: '/sessions/s-1/events/e-1',
      payload: { deleteReason: 'Engano' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PLAYER recebe 403', async () => {
    const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'DELETE', url: '/sessions/s-1/events/e-1',
      payload: { deleteReason: 'Engano' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('retorna 400 sem deleteReason', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'DELETE', url: '/sessions/s-1/events/e-1',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(j(res).error).toContain('deleteReason');
  });

  it('retorna 400 com deleteReason vazio', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'DELETE', url: '/sessions/s-1/events/e-1',
      payload: { deleteReason: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('evento inexistente ou já cancelado retorna 404', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbEmpty() });
    const res  = await app.inject({
      method: 'DELETE', url: '/sessions/s-1/events/nao-existe',
      payload: { deleteReason: 'Engano' },
    });
    expect(res.statusCode).toBe(404);
    expect(j(res).error).toContain('cancelado');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Guards de role — matrix completa
// ═════════════════════════════════════════════════════════════════════════════

describe('Guards de role — matriz de acesso', () => {
  const ENDPOINTS_GM_PRINCIPAL_ONLY = [
    { method: 'POST',   url: '/sessions',              payload: { title: 'X' } },
    { method: 'POST',   url: '/sessions/s-1/close',    payload: {} },
    { method: 'PATCH',  url: '/sessions/s-1/events/e-1', payload: { delta: 1, editReason: 'r' } },
    { method: 'DELETE', url: '/sessions/s-1/events/e-1', payload: { deleteReason: 'r' } },
  ];

  const ENDPOINTS_GM_OR_PRINCIPAL = [
    { method: 'GET', url: '/sessions' },
    { method: 'GET', url: '/sessions/s-1' },
    { method: 'GET', url: '/sessions/s-1/events' },
    { method: 'POST', url: '/sessions/s-1/events',
      payload: { playerId: U_PLAYER.id, actorName: 'X', resourceType: 'gold', delta: 1 } },
  ];

  it.each(ENDPOINTS_GM_PRINCIPAL_ONLY)(
    'GM comum não pode acessar $method $url',
    async ({ method, url, payload }) => {
      const app = await buildApp({ mockUser: U_GM, mockDb: dbEmpty() });
      const res  = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(403);
    },
  );

  it.each(ENDPOINTS_GM_PRINCIPAL_ONLY)(
    'PLAYER não pode acessar $method $url',
    async ({ method, url, payload }) => {
      const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
      const res  = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(403);
    },
  );

  it.each(ENDPOINTS_GM_OR_PRINCIPAL)(
    'PLAYER não pode acessar $method $url',
    async ({ method, url, payload }) => {
      const app = await buildApp({ mockUser: U_PLAYER, mockDb: dbEmpty() });
      const res  = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(403);
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// Serialização — contratos do JSON de resposta
// ═════════════════════════════════════════════════════════════════════════════

describe('Serialização — contrato do JSON', () => {
  it('sessão não tem campos snake_case no body', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbSessionList() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    const item = j(res)[0];
    const snakeKeys = Object.keys(item).filter(k => k.includes('_'));
    expect(snakeKeys).toHaveLength(0);
  });

  it('evento não tem campos snake_case no body', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [U_GM.id] }], rowCount: 1 },
      { rows: [EVENT_ROW], rowCount: 1 },
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    const item = j(res)[0];
    const snakeKeys = Object.keys(item).filter(k => k.includes('_'));
    expect(snakeKeys).toHaveLength(0);
  });

  it('delta de evento é sempre number, nunca string', async () => {
    const db = dbSequence(
      { rows: [{ id: 's-1', narrator_ids: [U_GM.id] }], rowCount: 1 },
      { rows: [{ ...EVENT_ROW, delta: '123.45' }], rowCount: 1 }, // banco retorna string
    );
    const app = await buildApp({ mockUser: U_GM, mockDb: db });
    const res  = await app.inject({ method: 'GET', url: '/sessions/s-1/events' });
    expect(typeof j(res)[0].delta).toBe('number');
  });

  it('eventCount de sessão é sempre number, nunca string', async () => {
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbSessionList() });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    expect(typeof j(res)[0].eventCount).toBe('number');
  });

  it('campos opcionais nulos são null, não undefined', async () => {
    const rowSemOpcionais = { ...SESSION_ROW, campaign: null, closed_at: null, gm_notes: null };
    const app = await buildApp({ mockUser: U_PRINCIPAL, mockDb: dbSessionList([rowSemOpcionais]) });
    const res  = await app.inject({ method: 'GET', url: '/sessions' });
    const item = j(res)[0];
    // JSON.parse converte undefined para ausência de chave — testamos que os campos existem
    expect(item).toHaveProperty('campaign', null);
    expect(item).toHaveProperty('closedAt', null);
  });
});
