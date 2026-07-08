/**
 * routes/sessions.js
 *
 * Módulo de log de sessões e rastreamento de recursos por jogador.
 *
 * Endpoints:
 *   POST   /sessions/:id/link-foundry          — GM/narrador: vincula sessão ao handshake Foundry
 *   POST   /sessions                           — GM_PRINCIPAL: abre uma nova sessão
 *   GET    /sessions                           — GM/GM_PRINCIPAL: lista sessões
 *   GET    /sessions/:id                       — GM/GM_PRINCIPAL: detalhes de uma sessão
 *   GET    /sessions/:id/narrator-access       — qualquer autenticado: verifica se é narrador
 *   POST   /sessions/:id/close                 — GM_PRINCIPAL: fecha a sessão
 *   POST   /sessions/:id/events               — GM/GM_PRINCIPAL/narrador: registra evento
 *   GET    /sessions/:id/events               — GM/GM_PRINCIPAL: lista eventos da sessão
 *   PATCH  /sessions/:id/events/:eid           — GM_PRINCIPAL: edita evento (com razão)
 *   DELETE /sessions/:id/events/:eid           — GM_PRINCIPAL: cancela evento (soft delete)
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
import { isFoundryRequest } from '../lib/foundryAuth.js';
import { isValidUuid } from '../lib/validation.js';
import { resolveEventIdentity } from '../services/actorResolution.js';

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
  // playerId OU actorId — não ambos exigidos. Requisições do módulo Foundry
  // enviam apenas actorId; a rota resolve playerId/characterId internamente
  // via resolveEventIdentity() antes de chegar aqui.
  //
  // resource_deltas é exclusivamente o log de CONSUMO DE RECURSO — todo
  // evento aqui tem um jogador/personagem dono. Eventos estruturais da
  // sessão (presença, cena, combate, etc.) têm uma tabela própria
  // (session_events) e um endpoint próprio — não passam por aqui.
  const { playerId, actorId, actorName, characterId, resourceType, delta, deltaMeta } = body ?? {};

  if (!playerId?.trim() && !actorId?.trim()) {
    reply.code(400).send({ error: 'playerId ou actorId é obrigatório.' });
    return false;
  }
  // actorName é obrigatório apenas quando characterId/actorId não estão presentes
  if (!characterId && !actorId && !actorName?.trim()) {
    reply.code(400).send({ error: 'actorName ou characterId é obrigatório.' });
    return false;
  }
  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    reply.code(400).send({
      error: `resourceType inválido. Valores aceitos: ${[...VALID_RESOURCE_TYPES].join(', ')}.`,
    });
    return false;
  }
  // Convenção: delta = 0 só é aceito quando deltaMeta.snapshot === true (ex:
  // HP final registrado em deleteCombat — não representa uma variação, mas
  // um estado pontual). Qualquer outro evento com delta 0 é rejeitado, pois
  // não haveria nada de fato a registrar.
  const isSnapshot = deltaMeta?.snapshot === true;
  if (typeof delta !== 'number' || !isFinite(delta) || (delta === 0 && !isSnapshot)) {
    reply.code(400).send({ error: 'delta deve ser um número diferente de zero (exceto eventos snapshot, com deltaMeta.snapshot=true).' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Fastify
// ─────────────────────────────────────────────────────────────────────────────

export async function sessionRoutes(fastify) {

  // ── POST /sessions/:id/link-foundry ───────────────────────────────────────
  // Vincula uma sessão aberta a um handshake do Foundry via código curto.
  // Chamado pelo frontend Nimrod quando o GM digita o código exibido no Foundry.
  //
  // Apenas GM e GM_PRINCIPAL que sejam narradores da sessão podem vincular.
  //
  // Body: { code }  (código de 7 caracteres gerado pelo módulo Foundry)
  //
  // Retorna:
  //   200 { ok, sessionId, worldId, gmName, players, tokens }
  //   400 código inválido / ausente / expirado / já usado
  //   403 não é narrador desta sessão
  //   404 sessão ou código não encontrado
  fastify.post('/sessions/:id/link-foundry', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    if (!isValidUuid(req.params.id)) {
      return reply.code(400).send({ error: 'ID de sessão inválido.' });
    }

    const { code } = req.body ?? {};
    if (!code?.trim()) {
      return reply.code(400).send({ error: 'code é obrigatório.' });
    }

    const normalizedCode = code.trim().toUpperCase();

    // Valida a sessão
    const sessionRes = await query(
      `SELECT id, status, narrator_ids, mission_id
       FROM session_logs
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!sessionRes.rows.length) {
      return reply.code(404).send({ error: 'Sessão não encontrada.' });
    }

    const sl = sessionRes.rows[0];

    if (sl.status !== 'open') {
      return reply.code(400).send({ error: `Sessão está com status "${sl.status}" — só sessões abertas podem ser vinculadas.` });
    }

    // Apenas narradores da sessão (ou GM_PRINCIPAL) podem vincular
    if (!isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Apenas narradores desta sessão podem vinculá-la ao Foundry.' });
    }

    // Busca o handshake — válido se não expirou e não foi claimado
    const hsRes = await query(
      `SELECT code, world_id, gm_name, players, tokens, expires_at, claimed_at, session_id
       FROM foundry_handshakes
       WHERE code = $1`,
      [normalizedCode],
    );

    if (!hsRes.rows.length) {
      return reply.code(400).send({ error: 'Código não encontrado. Verifique se está correto.' });
    }

    const hs = hsRes.rows[0];

    if (new Date(hs.expires_at) < new Date()) {
      return reply.code(400).send({ error: 'Código expirado. O módulo Foundry gera um novo código automaticamente ao inicializar.' });
    }

    if (hs.claimed_at) {
      // Permite re-vincular à mesma sessão (idempotente) — útil se o GM refez o fluxo
      if (hs.session_id === sl.id) {
        return {
          ok:        true,
          sessionId: sl.id,
          worldId:   hs.world_id,
          gmName:    hs.gm_name,
          players:   hs.players ?? [],
          tokens:    hs.tokens  ?? [],
          relinked:  true,
        };
      }
      return reply.code(400).send({ error: 'Código já utilizado para outra sessão.' });
    }

    // Vincula: atualiza o handshake com session_id e claimed_at
    await query(
      `UPDATE foundry_handshakes
       SET session_id = $1, claimed_at = NOW(), claimed_by = $2
       WHERE code = $3`,
      [sl.id, req.user.id, normalizedCode],
    );

    // Notifica via WS o módulo Foundry (que faz polling em /nimrod/handshake/status)
    // e também os clientes Nimrod conectados (ex.: para mostrar ícone de vinculado)
    broadcast('FOUNDRY_SESSION_LINKED', {
      sessionId: sl.id,
      worldId:   hs.world_id,
      gmName:    hs.gm_name,
      code:      normalizedCode,
    });

    req.log.info(
      { sessionId: sl.id, code: normalizedCode, worldId: hs.world_id, userId: req.user.id },
      'foundry session linked',
    );

    return {
      ok:        true,
      sessionId: sl.id,
      worldId:   hs.world_id,
      gmName:    hs.gm_name,
      players:   hs.players ?? [],
      tokens:    hs.tokens  ?? [],
    };
  });

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

  // ── GET /sessions/:id/narrator-access ─────────────────────────────────────
  // Endpoint leve para o módulo Foundry verificar se o usuário autenticado
  // é narrador da sessão informada, mesmo que seja PLAYER.
  //
  // Qualquer usuário autenticado pode chamar. Retorna:
  //   200 { narrator: true }   → usuário é narrador desta sessão (ou GM/GM_PRINCIPAL)
  //   200 { narrator: false }  → usuário não é narrador desta sessão
  //   404                      → sessão não encontrada
  //
  // Não expõe dados sigilosos da sessão (gmNotes, snapshots, eventos).
  fastify.get('/sessions/:id/narrator-access', async (req, reply) => {
    // Qualquer autenticado pode consultar (cfAuthMiddleware já garantiu req.user)
    if (!req.user?.id) {
      return reply.code(401).send({ error: 'Autenticação necessária.' });
    }

    const session = await fetchSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    // GM e GM_PRINCIPAL sempre têm acesso
    if (isGM(req.user)) {
      return { narrator: true };
    }

    // PLAYER: verifica se está na lista de narradores da sessão
    const isNarrator = session.narrator_ids.includes(req.user.id);
    return { narrator: isNarrator };
  });

  // ── POST /sessions/:id/events ──────────────────────────────────────────────
  // Registra um evento de recurso em uma sessão aberta.
  //
  // Dois caminhos de autenticação (ver hook global em index.js):
  //   1. X-Nimrod-Key (módulo Foundry) — sem req.user. Envia apenas `actorId`;
  //      resolveEventIdentity() traduz para playerId/characterId/actorName —
  //      exatamente a mesma função usada por POST /nimrod/session/presence.
  //   2. Cloudflare Access (GM/GM_PRINCIPAL via UI do Nimrod) — fluxo original,
  //      exige playerId explícito e checa narrator_ids.
  fastify.post('/sessions/:id/events', async (req, reply) => {
    const isFoundryOrigin = await isFoundryRequest(req);

    // requireGM só se aplica a chamadas humanas — a origem Foundry já foi
    // validada acima pela API key (não depende de req.user).
    if (!isFoundryOrigin) {
      if (!requireGM(req, reply)) return reply;
    }
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
      return reply.code(400).send({ error: `Sessão já está com status "${sl.status}" e não aceita novos eventos.` });
    }

    // GM comum só pode registrar em sessões onde é narrador. Chamadas de
    // origem Foundry (X-Nimrod-Key) já foram autorizadas no handshake/link
    // e não têm req.user — pulam esta checagem.
    if (!isFoundryOrigin && !isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Você não é narrador desta sessão.' });
    }

    if (!validateEventBody(req.body, reply)) return reply;

    const {
      playerId       = null,
      actorId        = null,
      characterId    = null,
      actorName      = null,
      resourceType,
      delta,
      valueBefore    = null,
      valueAfter     = null,
      deltaMeta      = {},
      description    = null,
      foundryEventId = null,
      occurredAt     = null,
      source         = isFoundryOrigin ? 'foundry' : 'manual',
    } = req.body;

    const resolvedSource = VALID_SOURCES.has(source) ? source : (isFoundryOrigin ? 'foundry' : 'manual');

    // Resolução única de identidade — mesma função usada por
    // POST /nimrod/session/presence. Regra estrita: actorId só resolve
    // se o personagem já foi sincronizado (foundry_actor_id preenchido).
    // resource_deltas exige sempre um dono — eventos sem ator/jogador
    // pertencem a session_events, não aqui.
    const identity = await resolveEventIdentity({ playerId, actorId, characterId, actorName });
    if (!identity) {
      return reply.code(400).send(
        actorId
          ? { error: `Nenhum personagem sincronizado encontrado para o actorId "${actorId}". Sincronize o personagem (foundry_actor_id) antes de registrar eventos.` }
          : { error: 'Não foi possível resolver playerId/actorName/characterId — verifique os dados enviados.' },
      );
    }

    const resolvedPlayerId    = identity.playerId;
    const resolvedCharacterId = identity.characterId;
    const resolvedActorName   = identity.actorName;

    // Verifica se jogador existe
    if (!isValidUuid(resolvedPlayerId)) {
      return reply.code(400).send({ error: `playerId inválido: "${resolvedPlayerId}". Deve ser um UUID.` });
    }
    const playerCheck = await query('SELECT id FROM users WHERE id = $1', [resolvedPlayerId]);
    if (!playerCheck.rows.length) {
      return reply.code(400).send({ error: 'playerId não encontrado.' });
    }

    // participant: informativo apenas — não bloqueia o registro do evento
    // (decisão explícita: um GM pode alterar a ficha de alguém fora da
    // lista oficial de participantes da missão sem perder o dado).
    let participant = false;
    if (sl.mission_id) {
      const participantCheck = await query(
        `SELECT 1
         FROM mission_participants
         WHERE mission_id = $1 AND user_id = $2
         LIMIT 1`,
        [sl.mission_id, resolvedPlayerId],
      );
      participant = participantCheck.rows.length > 0;
    }

    // registered_by: chamadas humanas usam req.user.id; chamadas do módulo
    // Foundry (X-Nimrod-Key) não têm req.user — usa o próprio jogador
    // resolvido como autor do registro.
    const registeredBy = isFoundryOrigin ? resolvedPlayerId : req.user.id;

    let res;
    try {
      res = await query(
        `INSERT INTO resource_deltas
           (session_id, player_id, actor_name,
            registered_by, source,
            resource_type, delta,
            value_before, value_after, delta_meta,
            description, foundry_event_id, occurred_at,
            out_of_session, arc_id, mission_id, character_id, participant)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 COALESCE($13::timestamptz, NOW()),
                 FALSE, $14, $15, $16, $17)
         RETURNING *`,
        [
          req.params.id,
          resolvedPlayerId,
          resolvedActorName,
          registeredBy,
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
          participant,
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