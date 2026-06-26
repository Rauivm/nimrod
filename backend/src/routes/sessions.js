/**
 * routes/sessions.js
 *
 * Módulo de log de sessões e rastreamento de recursos por jogador.
 *
 * Endpoints:
 *   POST   /sessions                    — GM_PRINCIPAL: abre uma nova sessão
 *   GET    /sessions                    — GM/GM_PRINCIPAL: lista sessões
 *   GET    /sessions/:id                — GM/GM_PRINCIPAL: detalhes de uma sessão
 *   POST   /sessions/:id/close         — GM_PRINCIPAL: fecha a sessão
 *   POST   /sessions/:id/events        — GM/GM_PRINCIPAL: registra evento de recurso
 *   GET    /sessions/:id/events        — GM/GM_PRINCIPAL: lista eventos da sessão
 *   PATCH  /sessions/:id/events/:eid   — GM_PRINCIPAL: edita evento (com razão)
 *   DELETE /sessions/:id/events/:eid   — GM_PRINCIPAL: cancela evento (soft delete)
 *
 * Guards de role:
 *   isGM          → role IN ('GM', 'GM_PRINCIPAL')
 *   isGMPrincipal → role === 'GM_PRINCIPAL'
 *
 * Nota: o auth (req.user) é injetado globalmente pelo cfAuthMiddleware em index.js.
 * Aqui apenas verificamos req.user.role — sem tocar em headers ou JWT.
 */

import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { assertRateLimit } from '../middleware/rateLimit.js';
import { isGM, isGMPrincipal, requireGM, requireGMPrincipal } from '../lib/roles.js';

// ─────────────────────────────────────────────────────────────────────────────
// Serializers
// ─────────────────────────────────────────────────────────────────────────────

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
    gmNotes:        row.gm_notes       ?? null,   // incluído apenas para GMs
    tags:           row.tags           ?? [],
    foundrySceneId: row.foundry_scene_id ?? null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    // Campos agregados (presentes em queries detalhadas)
    eventCount:     row.event_count != null ? Number(row.event_count) : undefined,
  };
}

function serializeEvent(row) {
  return {
    id:            row.id,
    sessionId:     row.session_id,
    arcId:         row.arc_id         ?? null,
    missionId:     row.mission_id     ?? null,
    characterId:   row.character_id   ?? null,
    outOfSession:  row.out_of_session ?? false,
    playerId:      row.player_id,
    playerName:    row.player_name    ?? null,
    actorName:     row.actor_name,
    registeredBy:  row.registered_by,
    registeredByName: row.registered_by_name ?? null,
    source:        row.source,
    resourceType:  row.resource_type,
    delta:         Number(row.delta),
    valueBefore:   row.value_before != null ? Number(row.value_before) : null,
    valueAfter:    row.value_after  != null ? Number(row.value_after)  : null,
    deltaMeta:     row.delta_meta   ?? {},
    description:   row.description  ?? null,
    foundryEventId: row.foundry_event_id ?? null,
    occurredAt:    row.occurred_at,
    createdAt:     row.created_at,
    editedAt:      row.edited_at    ?? null,
    editedBy:      row.edited_by    ?? null,
    editReason:    row.edit_reason  ?? null,
    deletedAt:     row.deleted_at   ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de query
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_SELECT = `
  SELECT
    sl.*,
    COALESCE(gm.display_name, gm.name) AS primary_gm_name,
    COUNT(rd.id)                        AS event_count
  FROM session_logs sl
  LEFT JOIN users gm ON gm.id = sl.primary_gm_id
  LEFT JOIN resource_deltas rd
         ON rd.session_id = sl.id AND rd.deleted_at IS NULL
`;

// Regex UUID v4 — evita que strings inválidas causem erro 500 no PostgreSQL
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

async function fetchSession(id) {
  if (!isValidUuid(id)) return null;
  const res = await query(
    `${SESSION_SELECT}
     WHERE sl.id = $1 AND sl.deleted_at IS NULL
     GROUP BY sl.id, gm.id, gm.display_name, gm.name`,
    [id],
  );
  return res.rows[0] ?? null;
}

const EVENT_SELECT = `
  SELECT
    rd.*,
    COALESCE(pu.display_name, pu.name) AS player_name,
    COALESCE(ru.display_name, ru.name) AS registered_by_name
  FROM resource_deltas rd
  LEFT JOIN users pu ON pu.id = rd.player_id
  LEFT JOIN users ru ON ru.id = rd.registered_by
`;

// ─────────────────────────────────────────────────────────────────────────────
// Validações de campo
// ─────────────────────────────────────────────────────────────────────────────

const VALID_RESOURCE_TYPES = new Set([
  'gold', 'xp', 'potion', 'spell_slot', 'item', 'hp', 'custom',
]);

const VALID_SOURCES = new Set(['foundry', 'manual', 'system']);

function validateSessionBody(body, reply) {
  const { title } = body ?? {};
  if (!title?.trim()) {
    reply.code(400).send({ error: 'title é obrigatório.' });
    return false;
  }
  if (title.trim().length > 200) {
    reply.code(400).send({ error: 'title deve ter no máximo 200 caracteres.' });
    return false;
  }
  return true;
}

function validateEventBody(body, reply) {
  // characterId é opcional: quando fornecido, actorName é derivado do banco.
  // Quando ausente, actorName é obrigatório (compatibilidade com source=foundry).
  const { playerId, actorName, characterId, resourceType, delta } = body ?? {};

  if (!playerId?.trim()) {
    reply.code(400).send({ error: 'playerId é obrigatório.' });
    return false;
  }
  // actorName é obrigatório apenas quando characterId não está presente
  if (!characterId && !actorName?.trim()) {
    reply.code(400).send({ error: 'actorName ou characterId é obrigatório.' });
    return false;
  }
  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    reply.code(400).send({
      error: `resourceType inválido. Valores aceitos: ${[...VALID_RESOURCE_TYPES].join(', ')}.`,
    });
    return false;
  }
  if (typeof delta !== 'number' || delta === 0 || !isFinite(delta)) {
    reply.code(400).send({ error: 'delta deve ser um número diferente de zero.' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Fastify
// ─────────────────────────────────────────────────────────────────────────────

export async function sessionRoutes(fastify) {

  // ── GET /sessions/players-with-characters ─────────────────────────────────
  // Retorna todos os jogadores (PLAYER, GM, GM_PRINCIPAL) com seus personagens
  // ativos, vivos e não aposentados. Usado pelo formulário de registro de evento.
  // Qualquer GM pode acessar.
  fastify.get('/sessions/players-with-characters', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    // Busca todos os usuários que têm ao menos um personagem ativo vinculado,
    // mais todos os usuários (para cobrir GMs sem personagem que podem aparecer
    // em eventos históricos de outros módulos).
    const usersRes = await query(
      `SELECT
         u.id,
         COALESCE(u.display_name, u.name) AS display_name,
         u.role,
         u.avatar_url
       FROM users u
       ORDER BY u.display_name NULLS LAST, u.name`,
    );

    // Busca todos os personagens ativos, vivos e não-aposentados, agrupados por user_id
    const charsRes = await query(
      `SELECT
         pc.id,
         pc.user_id,
         pc.name,
         pc.level,
         pc.token_img,
         pc.foundry_actor_id
       FROM player_characters pc
       WHERE
         pc.user_id  IS NOT NULL
         AND pc.active   = TRUE
         AND pc.retired  = FALSE
         AND pc.dead     = FALSE
       ORDER BY pc.name ASC`,
    );

    // Agrupa personagens por user_id
    const charsByUser = new Map();
    for (const ch of charsRes.rows) {
      const list = charsByUser.get(ch.user_id) ?? [];
      list.push({
        id:             ch.id,
        name:           ch.name,
        level:          ch.level,
        tokenImg:       ch.token_img,
        foundryActorId: ch.foundry_actor_id,
      });
      charsByUser.set(ch.user_id, list);
    }

    // Só retorna usuários que têm ao menos 1 personagem elegível,
    // mais qualquer usuário que já apareceu em eventos desta ou de outras sessões
    // (para não omitir GMs ou jogadores sem personagem no select).
    // A decisão de mostrar ou não usuários sem personagem fica no frontend.
    return usersRes.rows.map(u => ({
      id:          u.id,
      displayName: u.display_name,
      role:        u.role,
      avatarUrl:   u.avatar_url ?? null,
      characters:  charsByUser.get(u.id) ?? [],
    }));
  });

  // ── POST /sessions ─────────────────────────────────────────────────────────
  // Abre uma nova sessão. Apenas GM_PRINCIPAL.
  fastify.post('/sessions', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;
    if (!assertRateLimit(req, reply, 'sessions:create', { limit: 20, windowMs: 60_000 })) return reply;

    if (!validateSessionBody(req.body, reply)) return reply;

    const {
      title,
      campaign       = null,
      sessionNumber  = null,
      scheduledAt    = null,
      narratorIds    = [],
      playerIds      = [],
      gmNotes        = null,
      tags           = [],
      foundrySceneId = null,
    } = req.body;

    // Garante que o próprio GM Principal está na lista de narradores
    const resolvedNarratorIds = narratorIds.includes(req.user.id)
      ? narratorIds
      : [req.user.id, ...narratorIds];

    const res = await query(
      `INSERT INTO session_logs
         (title, campaign, session_number, scheduled_at,
          opened_by, primary_gm_id,
          narrator_ids, player_ids,
          gm_notes, tags, foundry_scene_id)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        title.trim(),
        campaign       ?? null,
        sessionNumber  ?? null,
        scheduledAt    ?? null,
        req.user.id,
        resolvedNarratorIds,
        playerIds,
        gmNotes        ?? null,
        tags,
        foundrySceneId ?? null,
      ],
    );

    const session = await fetchSession(res.rows[0].id);
    broadcast('SESSION_CREATED', serializeSession(session));
    return reply.code(201).send(serializeSession(session));
  });

  // ── GET /sessions ──────────────────────────────────────────────────────────
  // Lista sessões. GM vê apenas as que ele narrou; GM_PRINCIPAL vê todas.
  fastify.get('/sessions', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    const limit  = Math.min(parseInt(req.query.limit) || 30, 60);
    const status = req.query.status ?? null;  // 'open' | 'closed' | 'archived'
    const before = req.query.before ?? null;  // cursor: ISO timestamp

    const params = [];
    const where  = ['sl.deleted_at IS NULL'];

    // GMs comuns só enxergam sessões onde são narradores
    if (!isGMPrincipal(req.user)) {
      params.push(req.user.id);
      where.push(`$${params.length} = ANY(sl.narrator_ids)`);
    }

    if (status) {
      params.push(status);
      where.push(`sl.status = $${params.length}`);
    }

    if (before) {
      params.push(before);
      where.push(`sl.started_at < $${params.length}`);
    }

    params.push(limit);
    const sql = `
      ${SESSION_SELECT}
      WHERE ${where.join(' AND ')}
      GROUP BY sl.id, gm.id, gm.display_name, gm.name
      ORDER BY sl.started_at DESC
      LIMIT $${params.length}
    `;

    const res = await query(sql, params);
    return res.rows.map(serializeSession);
  });

  // ── GET /sessions/:id ──────────────────────────────────────────────────────
  // Detalhes completos de uma sessão, incluindo snapshot de recursos por jogador.
  fastify.get('/sessions/:id', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    const session = await fetchSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    // GM comum só pode ver sessões onde é narrador
    if (!isGMPrincipal(req.user) && !session.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Acesso negado a esta sessão.' });
    }

    // Totais por jogador (do snapshot se existir, senão agrega ao vivo)
    const snapshotRes = await query(
      `SELECT
         ss.*,
         COALESCE(u.display_name, u.name) AS player_name
       FROM session_snapshots ss
       LEFT JOIN users u ON u.id = ss.player_id
       WHERE ss.session_id = $1`,
      [session.id],
    );

    // Eventos recentes (últimos 50 do feed)
    const eventsRes = await query(
      `${EVENT_SELECT}
       WHERE rd.session_id = $1 AND rd.deleted_at IS NULL
       ORDER BY rd.occurred_at DESC
       LIMIT 50`,
      [session.id],
    );

    const serialized = serializeSession(session);

    // gm_notes só retorna para GMs
    if (!isGM(req.user)) {
      serialized.gmNotes = undefined;
    }

    return {
      ...serialized,
      snapshots:    snapshotRes.rows,
      recentEvents: eventsRes.rows.map(serializeEvent),
    };
  });

  // ── POST /sessions/:id/close ───────────────────────────────────────────────
  // Fecha a sessão e gera o snapshot consolidado de recursos. Apenas GM_PRINCIPAL.
  fastify.post('/sessions/:id/close', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;

    const session = await fetchSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    if (session.status !== 'open') {
      return reply.code(400).send({ error: `Sessão já está com status "${session.status}".` });
    }

    const { summary = null, gmNotes = null } = req.body ?? {};

    // Fecha a sessão
    await query(
      `UPDATE session_logs
       SET status = 'closed', closed_at = NOW(), closed_by = $1,
           summary = COALESCE($2, summary),
           gm_notes = COALESCE($3, gm_notes)
       WHERE id = $4`,
      [req.user.id, summary, gmNotes, session.id],
    );

    // Gera snapshot: agrega resource_deltas por jogador
    const totalsRes = await query(
      `SELECT
         player_id,
         MAX(actor_name)                                          AS actor_name,
         COALESCE(SUM(delta) FILTER (WHERE resource_type = 'gold'),       0) AS total_gold_delta,
         COALESCE(SUM(delta) FILTER (WHERE resource_type = 'xp'),         0) AS total_xp_delta,
         COALESCE(SUM(delta) FILTER (WHERE resource_type = 'hp'),         0) AS total_hp_delta,
         COALESCE(SUM(ABS(delta)) FILTER (WHERE resource_type = 'potion' AND delta < 0), 0) AS potions_used
       FROM resource_deltas
       WHERE session_id = $1 AND deleted_at IS NULL
       GROUP BY player_id`,
      [session.id],
    );

    // Upsert dos snapshots (idempotente: permite fechar/reabrir em staging)
    for (const row of totalsRes.rows) {
      await query(
        `INSERT INTO session_snapshots
           (session_id, player_id, actor_name,
            total_gold_delta, total_xp_delta, total_hp_delta, potions_used,
            computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (session_id, player_id) DO UPDATE SET
           actor_name       = EXCLUDED.actor_name,
           total_gold_delta = EXCLUDED.total_gold_delta,
           total_xp_delta   = EXCLUDED.total_xp_delta,
           total_hp_delta   = EXCLUDED.total_hp_delta,
           potions_used     = EXCLUDED.potions_used,
           computed_at      = NOW()`,
        [
          session.id,
          row.player_id,
          row.actor_name,
          row.total_gold_delta,
          row.total_xp_delta,
          row.total_hp_delta,
          row.potions_used,
        ],
      );
    }

    const closed = await fetchSession(session.id);
    broadcast('SESSION_CLOSED', serializeSession(closed));
    return serializeSession(closed);
  });

  // ── POST /sessions/:id/events ──────────────────────────────────────────────
  // Registra um evento de recurso em uma sessão aberta.
  // GM e GM_PRINCIPAL podem registrar. Foundry envia com source='foundry'.
  fastify.post('/sessions/:id/events', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    if (!assertRateLimit(req, reply, 'sessions:events', { limit: 120, windowMs: 60_000 })) return reply;

    if (!isValidUuid(req.params.id)) {
      return reply.code(400).send({
        error: `ID de sessão inválido: "${req.params.id}". O campo activeSessionId no módulo Foundry deve conter o UUID da sessão (ex: "a1b2c3d4-..."), não um número.`,
      });
    }

    const session = await query(
      `SELECT id, status, narrator_ids, arc_id, mission_id FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!session.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    const sl = session.rows[0];

    // Sessões fechadas ainda aceitam eventos — marcados como out_of_session = TRUE.
    // Isso preserva a sincronização com o Foundry sem criar inconsistências.
    if (sl.status !== 'open') {
      return reply.code(400).send({ error: `SessÃ£o jÃ¡ estÃ¡ com status "${sl.status}" e nÃ£o aceita novos eventos.` });
    }

    // GM comum só pode registrar em sessões onde é narrador (aberta ou fechada)
    if (!isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Você não é narrador desta sessão.' });
    }

    if (!validateEventBody(req.body, reply)) return reply;

    const {
      playerId,
      characterId    = null,
      resourceType,
      delta,
      valueBefore    = null,
      valueAfter     = null,
      deltaMeta      = {},
      description    = null,
      foundryEventId = null,
      occurredAt     = null,
      source         = 'manual',
    } = req.body;

    const resolvedSource = VALID_SOURCES.has(source) ? source : 'manual';

    // Verifica se jogador existe
    if (!isValidUuid(playerId)) {
      return reply.code(400).send({ error: `playerId inválido: "${playerId}". Deve ser um UUID.` });
    }
    const playerCheck = await query('SELECT id FROM users WHERE id = $1', [playerId]);
    if (!playerCheck.rows.length) {
      return reply.code(400).send({ error: 'playerId não encontrado.' });
    }

    if (sl.mission_id) {
      const participantCheck = await query(
        `SELECT 1
         FROM mission_participants
         WHERE mission_id = $1 AND user_id = $2
         LIMIT 1`,
        [sl.mission_id, playerId],
      );
      if (!participantCheck.rows.length) {
        return reply.code(403).send({ error: 'Jogador nÃ£o participa desta missÃ£o.' });
      }
    }

    // Resolve actorName: se characterId foi fornecido, valida e deriva o nome
    let resolvedActorName = req.body.actorName?.trim() ?? null;

    let resolvedCharacterId = characterId;

    if (resolvedCharacterId) {
      if (!isValidUuid(resolvedCharacterId)) {
        return reply.code(400).send({ error: `characterId inválido: "${characterId}". Deve ser um UUID.` });
      }
      const charCheck = await query(
        `SELECT id, name, user_id, active, retired, dead
         FROM player_characters
         WHERE id = $1`,
        [resolvedCharacterId],
      );

      if (!charCheck.rows.length) {
        return reply.code(400).send({ error: 'Personagem não encontrado.' });
      }

      const ch = charCheck.rows[0];

      if (ch.user_id !== playerId) {
        return reply.code(400).send({ error: 'Personagem não pertence ao jogador informado.' });
      }
      if (!ch.active) {
        return reply.code(400).send({ error: 'Personagem inativo.' });
      }
      if (ch.retired) {
        return reply.code(400).send({ error: 'Personagem aposentado.' });
      }
      if (ch.dead) {
        return reply.code(400).send({ error: 'Personagem morto.' });
      }

      resolvedActorName = ch.name;
    }

    if (!resolvedActorName) {
      return reply.code(400).send({ error: 'actorName ou characterId válido é obrigatório.' });
    }

    if (!resolvedCharacterId) {
      const charByName = await query(
        `SELECT id
         FROM player_characters
         WHERE user_id = $1
           AND lower(name) = lower($2)
           AND active = TRUE
           AND retired = FALSE
           AND dead = FALSE
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [playerId, resolvedActorName],
      );
      resolvedCharacterId = charByName.rows[0]?.id ?? null;
    }

    let res;
    try {
      res = await query(
        `INSERT INTO resource_deltas
           (session_id, player_id, actor_name,
            registered_by, source,
            resource_type, delta,
            value_before, value_after, delta_meta,
            description, foundry_event_id, occurred_at,
            out_of_session, arc_id, mission_id, character_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 COALESCE($13::timestamptz, NOW()),
                 FALSE, $14, $15, $16)
         RETURNING *`,
        [
          req.params.id,
          playerId,
          resolvedActorName,
          req.user.id,
          resolvedSource,
          resourceType,
          delta,
          valueBefore,
          valueAfter,
          JSON.stringify(deltaMeta),
          description?.trim() ?? null,
          foundryEventId ?? null,
          occurredAt,
          sl.arc_id     ?? null,
          sl.mission_id ?? null,
          resolvedCharacterId ?? null,
        ],
      );
    } catch (err) {
      // Chave duplicada em foundry_event_id → idempotência para o módulo Foundry
      if (err.code === '23505' && err.constraint?.includes('foundry_event_id')) {
        return reply.code(409).send({ error: 'Evento já registrado (foundry_event_id duplicado).' });
      }
      throw err;
    }

    // Busca o evento serializado com os joins de nome
    const eventRes = await query(
      `${EVENT_SELECT} WHERE rd.id = $1`,
      [res.rows[0].id],
    );
    const event = serializeEvent(eventRes.rows[0]);

    broadcast('SESSION_EVENT_CREATED', { sessionId: req.params.id, event });
    return reply.code(201).send(event);
  });

  // ── GET /sessions/:id/events ───────────────────────────────────────────────
  // Lista eventos de uma sessão com filtros e paginação.
  fastify.get('/sessions/:id/events', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    if (!isValidUuid(req.params.id)) {
      return reply.code(400).send({ error: `ID de sessão inválido: "${req.params.id}".` });
    }

    const session = await query(
      `SELECT id, narrator_ids FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!session.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    const sl = session.rows[0];
    if (!isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Acesso negado a esta sessão.' });
    }

    const limit        = Math.min(parseInt(req.query.limit) || 50, 200);
    const before       = req.query.before       ?? null;
    const playerId     = req.query.playerId     ?? null;
    const resourceType = req.query.resourceType ?? null;
    const source       = req.query.source       ?? null;
    const includeDeleted = req.query.includeDeleted === 'true' && isGMPrincipal(req.user);

    const params = [req.params.id];
    const where  = ['rd.session_id = $1'];

    if (!includeDeleted) where.push('rd.deleted_at IS NULL');

    if (playerId) {
      params.push(playerId);
      where.push(`rd.player_id = $${params.length}`);
    }
    if (resourceType && VALID_RESOURCE_TYPES.has(resourceType)) {
      params.push(resourceType);
      where.push(`rd.resource_type = $${params.length}`);
    }
    if (source && VALID_SOURCES.has(source)) {
      params.push(source);
      where.push(`rd.source = $${params.length}`);
    }
    if (before) {
      params.push(before);
      where.push(`rd.occurred_at < $${params.length}`);
    }

    params.push(limit);
    const res = await query(
      `${EVENT_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY rd.occurred_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return res.rows.map(serializeEvent);
  });

  // ── PATCH /sessions/:id/events/:eid ───────────────────────────────────────
  // Edição retroativa de um evento. Apenas GM_PRINCIPAL. Requer editReason.
  fastify.patch('/sessions/:id/events/:eid', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;

    if (!isValidUuid(req.params.id) || !isValidUuid(req.params.eid)) {
      return reply.code(400).send({ error: 'ID de sessão ou evento inválido.' });
    }

    const { editReason, delta, valueBefore, valueAfter, deltaMeta, description, occurredAt } = req.body ?? {};

    if (!editReason?.trim()) {
      return reply.code(400).send({ error: 'editReason é obrigatório para edições retroativas.' });
    }

    // Busca o evento e confirma que pertence à sessão
    const existing = await query(
      `SELECT rd.*, sl.status AS session_status
       FROM resource_deltas rd
       JOIN session_logs sl ON sl.id = rd.session_id
       WHERE rd.id = $1 AND rd.session_id = $2 AND rd.deleted_at IS NULL`,
      [req.params.eid, req.params.id],
    );
    if (!existing.rows.length) {
      return reply.code(404).send({ error: 'Evento não encontrado.' });
    }

    const ev = existing.rows[0];

    // Valida delta se fornecido
    if (delta !== undefined && (typeof delta !== 'number' || delta === 0 || !isFinite(delta))) {
      return reply.code(400).send({ error: 'delta deve ser um número diferente de zero.' });
    }

    const updates = [];
    const params  = [];

    if (delta !== undefined) {
      params.push(delta);
      updates.push(`delta = $${params.length}`);
    }
    if (valueBefore !== undefined) {
      params.push(valueBefore);
      updates.push(`value_before = $${params.length}`);
    }
    if (valueAfter !== undefined) {
      params.push(valueAfter);
      updates.push(`value_after = $${params.length}`);
    }
    if (deltaMeta !== undefined) {
      params.push(JSON.stringify(deltaMeta));
      updates.push(`delta_meta = $${params.length}`);
    }
    if (description !== undefined) {
      params.push(description?.trim() ?? null);
      updates.push(`description = $${params.length}`);
    }
    if (occurredAt !== undefined) {
      params.push(occurredAt);
      updates.push(`occurred_at = $${params.length}::timestamptz`);
    }

    if (!updates.length) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    // Audit fields — o trigger fn_audit_resource_delta os usará para gravar o histórico
    params.push(req.user.id);
    updates.push(`edited_by = $${params.length}`);
    params.push(editReason.trim());
    updates.push(`edit_reason = $${params.length}`);
    updates.push('edited_at = NOW()');

    params.push(ev.id);
    await query(
      `UPDATE resource_deltas SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    const updated = await query(`${EVENT_SELECT} WHERE rd.id = $1`, [ev.id]);
    const event   = serializeEvent(updated.rows[0]);

    broadcast('SESSION_EVENT_UPDATED', { sessionId: req.params.id, event });
    return event;
  });

  // ── DELETE /sessions/:id/events/:eid ──────────────────────────────────────
  // Soft-delete de um evento (não apaga o registro, apenas marca como cancelado).
  // Apenas GM_PRINCIPAL. Requer deleteReason.
  fastify.delete('/sessions/:id/events/:eid', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;

    if (!isValidUuid(req.params.id) || !isValidUuid(req.params.eid)) {
      return reply.code(400).send({ error: 'ID de sessão ou evento inválido.' });
    }

    const { deleteReason } = req.body ?? {};
    if (!deleteReason?.trim()) {
      return reply.code(400).send({ error: 'deleteReason é obrigatório para cancelar um evento.' });
    }

    const existing = await query(
      `SELECT rd.id FROM resource_deltas rd
       WHERE rd.id = $1 AND rd.session_id = $2 AND rd.deleted_at IS NULL`,
      [req.params.eid, req.params.id],
    );
    if (!existing.rows.length) {
      return reply.code(404).send({ error: 'Evento não encontrado ou já cancelado.' });
    }

    // O trigger fn_audit_resource_delta grava o snapshot na resource_delta_audit
    await query(
      `UPDATE resource_deltas
       SET deleted_at = NOW(), deleted_by = $1, delete_reason = $2
       WHERE id = $3`,
      [req.user.id, deleteReason.trim(), req.params.eid],
    );

    broadcast('SESSION_EVENT_DELETED', { sessionId: req.params.id, eventId: req.params.eid });
    return { deleted: true, eventId: req.params.eid };
  });
}
