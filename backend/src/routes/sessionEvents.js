/**
 * src/routes/sessionEvents.js
 *
 * Endpoints para session_events — o Event Store de fatos estruturais da
 * sessão (presença, cena, combate, tokens, e futuros: portas, macros,
 * journals, etc.). Deliberadamente separado de sessions.js/resource_deltas:
 * são domínios diferentes (ver comentário no topo da migration 028).
 *
 * Rotas:
 *   POST /sessions/:id/session-events        — GM/narrador/módulo Foundry: registra um evento estrutural
 *   GET  /sessions/:id/session-events         — GM/GM_PRINCIPAL: lista a timeline da sessão
 *
 * Autenticação: mesmo padrão dual de /sessions/:id/events —
 * X-Nimrod-Key (módulo Foundry) OU Cloudflare Access (GM/GM_PRINCIPAL via UI).
 *
 * Diferença chave em relação a resource_deltas: aqui, actorId/playerId/
 * characterId são TODOS opcionais. Muitos eventos genuinamente não têm
 * dono (SCENE_CHANGED, COMBAT_STARTED) — não fabricamos um proprietário.
 * Quando actorId é enviado mas não resolve para um personagem sincronizado
 * (ex: um NPC, que nunca existe como player_characters), o evento ainda é
 * gravado — actor_id (bruto) fica preenchido, character_id/player_id ficam
 * null. Isso é intencional: session_events existe para capturar TUDO, não
 * só o que já está sincronizado com o Nimrod.
 *
 * ── session_attendance é uma PROJEÇÃO, não uma segunda origem ──────────────
 * session_events é a única fonte de verdade para presença. session_attendance
 * (entered_at/left_at/last_seen_at) é um estado DERIVADO, atualizado como
 * efeito colateral de processar eventos PLAYER_CONNECTED/DISCONNECTED/
 * RECONNECTED/HEARTBEAT — nunca escrito diretamente por nenhum outro
 * caminho. Isso existe apenas por conveniência de leitura (consultas
 * rápidas de "quem está online agora" sem varrer a timeline inteira); se a
 * projeção falhar por qualquer motivo, o evento em session_events (a fonte
 * de verdade) já foi gravado e nunca é perdido — a projeção pode, em
 * princípio, ser reconstruída do zero reprocessando a timeline.
 * 
 */

import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { assertRateLimit } from '../middleware/rateLimit.js';
import { isGMPrincipal, requireGM } from '../lib/roles.js';
import { isFoundryRequest } from '../lib/foundryAuth.js';
import { isValidUuid } from '../lib/validation.js';
import { resolveEventIdentity } from '../services/actorResolution.js';

function serializeSessionEvent(row) {
  return {
    id:             row.id,
    sessionId:      row.session_id,
    missionId:      row.mission_id ?? null,
    eventType:      row.event_type,
    occurredAt:     row.occurred_at,
    actorId:        row.actor_id     ?? null,
    actorName:      row.actor_name   ?? null,
    characterId:    row.character_id ?? null,
    playerId:       row.player_id    ?? null,
    playerName:     row.player_name  ?? null,
    payload:        row.payload      ?? {},
    foundryEventId: row.foundry_event_id ?? null,
    createdAt:      row.created_at,
  };
}
// ── Projeção: session_events → session_attendance ──────────────────────────
// Único ponto do sistema que escreve em session_attendance. Ver nota de
// arquitetura no topo do arquivo — isto é um efeito colateral best-effort,
// nunca uma segunda fonte de verdade.
const PLAYER_HANDLERS_EVENT_TYPES = Object.freeze({
  CONNECTED:    'PLAYER_CONNECTED',
  DISCONNECTED: 'PLAYER_DISCONNECTED',
  RECONNECTED:  'PLAYER_RECONNECTED',
  HEARTBEAT:    'PLAYER_HEARTBEAT',
});

const ATTENDANCE_PROJECTED_TYPES = new Set(Object.values(PLAYER_HANDLERS_EVENT_TYPES));

/**
 * Aplica o efeito de um evento de presença recém-gravado sobre
 * session_attendance. Chamada DEPOIS que o INSERT em session_events já
 * teve sucesso — uma falha aqui nunca deve derrubar a resposta da rota
 * nem sugerir que o evento não foi registrado (ele foi; isto é só a
 * projeção de leitura rápida).
 *
 * @returns {Promise<void>}
 */
async function applyAttendanceProjection({ sessionId, missionId, eventType, playerId, characterId, actorName, occurredAt }) {
  if (!playerId || !ATTENDANCE_PROJECTED_TYPES.has(eventType)) return;

  const ts = occurredAt ? new Date(occurredAt) : new Date();

  if (eventType === PLAYER_HANDLERS_EVENT_TYPES.CONNECTED || eventType === PLAYER_HANDLERS_EVENT_TYPES.RECONNECTED) {
    // left_at = NULL: reconectou/entrou de novo, limpa qualquer saída anterior
    await query(
      `INSERT INTO session_attendance
         (session_id, mission_id, user_id, character_id, actor_name, entered_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (session_id, user_id) DO UPDATE SET
         character_id = COALESCE(EXCLUDED.character_id, session_attendance.character_id),
         actor_name   = COALESCE(EXCLUDED.actor_name,   session_attendance.actor_name),
         last_seen_at = EXCLUDED.last_seen_at,
         left_at      = NULL`,
      [sessionId, missionId, playerId, characterId, actorName, ts],
    );
  } else if (eventType === PLAYER_HANDLERS_EVENT_TYPES.DISCONNECTED) {
    await query(
      `UPDATE session_attendance
       SET left_at = $1, last_seen_at = $1
       WHERE session_id = $2 AND user_id = $3 AND left_at IS NULL`,
      [ts, sessionId, playerId],
    );
  } else if (eventType === PLAYER_HANDLERS_EVENT_TYPES.HEARTBEAT) {
    await query(
      `UPDATE session_attendance SET last_seen_at = $1 WHERE session_id = $2 AND user_id = $3`,
      [ts, sessionId, playerId],
    );
  }
}


export async function sessionEventRoutes(fastify) {

  // ── POST /sessions/:id/session-events ──────────────────────────────────
  fastify.post('/sessions/:id/session-events', async (req, reply) => {
    const isFoundryOrigin = await isFoundryRequest(req);

    if (!isFoundryOrigin) {
      if (!requireGM(req, reply)) return reply;
    }
    // Chave de rate limit inclui o sessionId: chamadas com origem Foundry
    // (X-Nimrod-Key) não têm req.user, então o fallback padrão seria só o
    // IP — o que faria TODAS as sessões concorrentes (possivelmente vários
    // mundos Foundry atrás do mesmo proxy/NAT) dividirem um único balde.
    // Prefixar com o sessionId garante um balde por sessão.
    if (!assertRateLimit(req, reply, `sessions:session-events:${req.params.id}`, { limit: 600, windowMs: 60_000 })) return reply;

    //if (!assertRateLimit(req, reply, 'sessions:session-events', { limit: 240, windowMs: 60_000 })) return reply;

    if (!isValidUuid(req.params.id)) {
      return reply.code(400).send({ error: `ID de sessão inválido: "${req.params.id}".` });
    }

    const session = await query(
      `SELECT id, status, narrator_ids, mission_id FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!session.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    const sl = session.rows[0];

    if (sl.status !== 'open') {
      return reply.code(400).send({ error: `Sessão já está com status "${sl.status}" e não aceita novos eventos.` });
    }

    if (!isFoundryOrigin && !isGMPrincipal(req.user) && !sl.narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Você não é narrador desta sessão.' });
    }

    const {
      eventType,
      actorId        = null,
      actorName      = null,
      foundryName    = null,
      characterId    = null,
      playerId       = null,
      payload        = {},
      foundryEventId = null,
      occurredAt     = null,
    } = req.body ?? {};

    if (!eventType?.trim()) {
      return reply.code(400).send({ error: 'eventType é obrigatório.' });
    }
    if (payload !== null && typeof payload !== 'object') {
      return reply.code(400).send({ error: 'payload deve ser um objeto.' });
    }

    // Resolução de identidade — best-effort, NUNCA bloqueante. Diferente
    // de resource_deltas, aqui não exigimos que a resolução funcione: um
    // actorId de NPC (nunca sincronizado) ou de um personagem ainda não
    // sincronizado continua gerando o evento normalmente, só sem
    // character_id/player_id preenchidos.
    let resolvedCharacterId = characterId ?? null;
    let resolvedPlayerId    = playerId    ?? null;
    let resolvedActorName   = actorName   ?? null;

    if (!resolvedPlayerId && actorId) {
      const identity = await resolveEventIdentity({ actorId, actorName });
      if (identity) {
        resolvedPlayerId    = identity.playerId;
        resolvedCharacterId = resolvedCharacterId ?? identity.characterId;
        resolvedActorName   = resolvedActorName   ?? identity.actorName;
      }
      // identity === null (ex: NPC, personagem não sincronizado) → segue
      // sem interromper; actor_id bruto é preservado abaixo de qualquer forma.
    }

    if (resolvedPlayerId && !isValidUuid(resolvedPlayerId)) {
      return reply.code(400).send({ error: `playerId inválido: "${resolvedPlayerId}".` });
    }
    if (resolvedCharacterId && !isValidUuid(resolvedCharacterId)) {
      return reply.code(400).send({ error: `characterId inválido: "${resolvedCharacterId}".` });
    }

    let res;
    try {
      res = await query(
        `INSERT INTO session_events
           (session_id, mission_id, event_type, occurred_at,
            actor_id, actor_name, character_id, player_id,
            payload, foundry_event_id)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()),
                 $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          req.params.id,
          sl.mission_id ?? null,
          eventType.trim(),
          occurredAt,
          actorId ?? null,
          resolvedActorName,
          resolvedCharacterId,
          resolvedPlayerId,
          JSON.stringify(payload ?? {}),
          foundryEventId ?? null,
        ],
      );
    } catch (err) {
      if (err.code === '23505' && err.constraint?.includes('foundry_event_id')) {
        return reply.code(409).send({ error: 'Evento já registrado (foundry_event_id duplicado).' });
      }
      throw err;
    }

    const event = serializeSessionEvent(res.rows[0]);
    broadcast('SESSION_EVENT_LOGGED', { sessionId: req.params.id, event });
    return reply.code(201).send(event);
  });

  // ── GET /sessions/:id/session-events ───────────────────────────────────
  // Timeline cronológica da sessão. Filtro opcional por eventType
  // (separado por vírgula, mesmo padrão já usado em GET /missions?status=).
  fastify.get('/sessions/:id/session-events', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    if (!isValidUuid(req.params.id)) {
      return reply.code(400).send({ error: `ID de sessão inválido: "${req.params.id}".` });
    }

    const session = await query(
      `SELECT id, narrator_ids FROM session_logs WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!session.rows.length) return reply.code(404).send({ error: 'Sessão não encontrada.' });

    if (!isGMPrincipal(req.user) && !session.rows[0].narrator_ids.includes(req.user.id)) {
      return reply.code(403).send({ error: 'Você não é narrador desta sessão.' });
    }

    const { eventType, limit = '500' } = req.query ?? {};
    const params = [req.params.id];
    const where  = ['session_id = $1'];

    if (eventType) {
      const types = eventType.split(',').map(t => t.trim()).filter(Boolean);
      params.push(types);
      where.push(`event_type = ANY($${params.length})`);
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);
    params.push(parsedLimit);


    const res = await query(
      `SELECT se.*, COALESCE(u.display_name, u.name) AS player_name
       FROM session_events se
       LEFT JOIN users u ON u.id = se.player_id
       WHERE ${where.join(' AND ')}
       ORDER BY se.occurred_at ASC
       LIMIT $${params.length}`,
      params,
    );

    return res.rows.map(serializeSessionEvent);
  });
}