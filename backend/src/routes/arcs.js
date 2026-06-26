/**
 * routes/arcs.js
 *
 * Gerenciamento de Arcos narrativos dentro de Missões.
 *
 * Hierarquia: Mission → Arc → Session → ResourceDelta
 *
 * Endpoints:
 *   POST   /missions/:missionId/arcs              — GM_PRINCIPAL: cria arco
 *   GET    /missions/:missionId/arcs              — GM: lista arcos da missão
 *   GET    /missions/:missionId/arcs/:arcId       — GM: detalhes do arco
 *   POST   /missions/:missionId/arcs/:arcId/close — GM_PRINCIPAL: fecha arco e distribui recompensas
 *
 *   POST   /arcs/:arcId/participants              — GM: adiciona personagem ao arco
 *   DELETE /arcs/:arcId/participants/:characterId — GM: remove personagem do arco
 *   GET    /arcs/:arcId/participants              — GM: lista participantes
 *
 *   GET    /arcs/:arcId/timeline                 — GM: sessões + eventos do arco
 */

import { query }    from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { isGM, isGMPrincipal, requireGM, requireGMPrincipal } from '../lib/roles.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid  = v => typeof v === 'string' && UUID_RE.test(v);

function bad(reply, msg) { reply.code(400).send({ error: msg }); }
function notFound(reply, msg = 'Não encontrado.') { reply.code(404).send({ error: msg }); }

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeArc(row) {
  return {
    id:               row.id,
    missionId:        row.mission_id,
    title:            row.title,
    arcNumber:        row.arc_number,
    description:      row.description     ?? null,
    status:           row.status,
    startedAt:        row.started_at,
    closedAt:         row.closed_at       ?? null,
    primaryGmId:      row.primary_gm_id,
    primaryGmName:    row.primary_gm_name ?? null,
    rewardXp:         row.reward_xp       != null ? Number(row.reward_xp)   : 0,
    rewardGold:       row.reward_gold     != null ? Number(row.reward_gold) : 0,
    rewardNotes:      row.reward_notes    ?? null,
    rewardsDistributed: row.rewards_distributed ?? false,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    // Campos agregados (quando presentes)
    sessionCount:     row.session_count   != null ? Number(row.session_count)      : undefined,
    participantCount: row.participant_count != null ? Number(row.participant_count) : undefined,
    eventCount:       row.event_count     != null ? Number(row.event_count)        : undefined,
  };
}

function serializeParticipant(row) {
  return {
    id:          row.id,
    arcId:       row.arc_id,
    missionId:   row.mission_id,
    characterId: row.character_id,
    userId:      row.user_id,
    type:        row.type,
    joinedAt:    row.joined_at,
    leftAt:      row.left_at     ?? null,
    xpAwarded:   row.xp_awarded  != null ? Number(row.xp_awarded)   : null,
    goldAwarded: row.gold_awarded != null ? Number(row.gold_awarded) : null,
    awardedAt:   row.awarded_at  ?? null,
    // Joined fields
    characterName: row.character_name  ?? null,
    playerName:    row.player_name     ?? null,
    tokenImg:      row.token_img       ?? null,
    level:         row.level           ?? null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ARC_SELECT = `
  SELECT
    ma.*,
    COALESCE(gm.display_name, gm.name)       AS primary_gm_name,
    COUNT(DISTINCT sl.id)                     AS session_count,
    COUNT(DISTINCT ap.id) FILTER (WHERE ap.left_at IS NULL) AS participant_count,
    COUNT(DISTINCT rd.id)                     AS event_count
  FROM mission_arcs ma
  LEFT JOIN users gm            ON gm.id = ma.primary_gm_id
  LEFT JOIN session_logs sl     ON sl.arc_id = ma.id     AND sl.deleted_at IS NULL
  LEFT JOIN arc_participants ap ON ap.arc_id = ma.id
  LEFT JOIN resource_deltas rd  ON rd.arc_id = ma.id     AND rd.deleted_at IS NULL
`;

async function fetchArc(arcId, missionId) {
  if (!isUuid(arcId)) return null;
  const res = await query(
    `${ARC_SELECT}
     WHERE ma.id = $1
       AND ($2::uuid IS NULL OR ma.mission_id = $2)
       AND ma.deleted_at IS NULL
     GROUP BY ma.id, gm.id, gm.display_name, gm.name`,
    [arcId, missionId ?? null],
  );
  return res.rows[0] ?? null;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export async function arcRoutes(fastify) {

  // ── POST /missions/:missionId/arcs ─────────────────────────────────────────
  fastify.post('/missions/:missionId/arcs', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;
    const { missionId } = req.params;
    if (!isUuid(missionId)) return bad(reply, 'missionId inválido.');

    const missionCheck = await query('SELECT id FROM missions WHERE id = $1', [missionId]);
    if (!missionCheck.rows.length) return notFound(reply, 'Missão não encontrada.');

    const { title, description = null, rewardXp = 0, rewardGold = 0, rewardNotes = null } = req.body ?? {};
    if (!title?.trim()) return bad(reply, 'title é obrigatório.');

    // Próximo arc_number desta missão
    const numRes = await query(
      'SELECT COALESCE(MAX(arc_number), 0) + 1 AS next_num FROM mission_arcs WHERE mission_id = $1 AND deleted_at IS NULL',
      [missionId],
    );
    const arcNumber = numRes.rows[0].next_num;

    const res = await query(
      `INSERT INTO mission_arcs
         (mission_id, title, arc_number, description, primary_gm_id, reward_xp, reward_gold, reward_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [missionId, title.trim(), arcNumber, description, req.user.id, rewardXp, rewardGold, rewardNotes],
    );
    const arc = await fetchArc(res.rows[0].id, missionId);
    broadcast('ARC_CREATED', serializeArc(arc));
    return reply.code(201).send(serializeArc(arc));
  });

  // ── GET /missions/:missionId/arcs ──────────────────────────────────────────
  fastify.get('/missions/:missionId/arcs', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const { missionId } = req.params;
    if (!isUuid(missionId)) return bad(reply, 'missionId inválido.');

    const res = await query(
      `${ARC_SELECT}
       WHERE ma.mission_id = $1 AND ma.deleted_at IS NULL
       GROUP BY ma.id, gm.id, gm.display_name, gm.name
       ORDER BY ma.arc_number ASC`,
      [missionId],
    );
    return res.rows.map(serializeArc);
  });

  // ── GET /missions/:missionId/arcs/:arcId ───────────────────────────────────
  fastify.get('/missions/:missionId/arcs/:arcId', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const arc = await fetchArc(req.params.arcId, req.params.missionId);
    if (!arc) return notFound(reply, 'Arco não encontrado.');
    return serializeArc(arc);
  });

  // ── POST /missions/:missionId/arcs/:arcId/close ────────────────────────────
  // Fecha o arco, calcula totais e distribui XP/gold para os participantes.
  fastify.post('/missions/:missionId/arcs/:arcId/close', async (req, reply) => {
    if (!requireGMPrincipal(req, reply)) return reply;

    const arc = await fetchArc(req.params.arcId, req.params.missionId);
    if (!arc) return notFound(reply, 'Arco não encontrado.');
    if (arc.status !== 'active') {
      return reply.code(400).send({ error: `Arco já está "${arc.status}".` });
    }

    const {
      rewardXp    = arc.reward_xp    ?? 0,
      rewardGold  = arc.reward_gold  ?? 0,
      rewardNotes = arc.reward_notes ?? null,
      summary     = null,
      distribute  = false,  // true = distribui XP/gold agora
    } = req.body ?? {};

    // Fecha o arco
    await query(
      `UPDATE mission_arcs
       SET status = 'closed', closed_at = NOW(), closed_by = $1,
           reward_xp = $2, reward_gold = $3, reward_notes = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [req.user.id, rewardXp, rewardGold, rewardNotes, arc.id],
    );

    // Fecha quaisquer sessões abertas vinculadas a este arco
    await query(
      `UPDATE session_logs
       SET status = 'closed', closed_at = NOW(), closed_by = $1
       WHERE arc_id = $2 AND status = 'open' AND deleted_at IS NULL`,
      [req.user.id, arc.id],
    );

    // Distribui recompensas se solicitado
    if (distribute && (Number(rewardXp) > 0 || Number(rewardGold) > 0)) {
      // Busca participantes ativos do arco
      const participants = await query(
        `SELECT * FROM arc_participants WHERE arc_id = $1 AND left_at IS NULL`,
        [arc.id],
      );

      for (const p of participants.rows) {
        await query(
          `UPDATE arc_participants
           SET xp_awarded = $1, gold_awarded = $2, awarded_at = NOW()
           WHERE id = $3`,
          [rewardXp, rewardGold, p.id],
        );

        // Registra os deltas como eventos do sistema para auditabilidade
        // Usa session_id = NULL (fora de sessão) pois o arco está fechado
        if (Number(rewardXp) > 0) {
          await query(
            `INSERT INTO resource_deltas
               (session_id, arc_id, mission_id, player_id, character_id,
                actor_name, registered_by, source,
                resource_type, delta, description, out_of_session, occurred_at)
             SELECT
               NULL, $1, $2, $3, $4,
               pc.name, $5, 'system',
               'xp', $6,
               'Recompensa de arco: ' || $7,
               TRUE, NOW()
             FROM player_characters pc WHERE pc.id = $4`,
            [arc.id, arc.mission_id, p.user_id, p.character_id,
             req.user.id, rewardXp, arc.title],
          );
        }

        if (Number(rewardGold) > 0) {
          await query(
            `INSERT INTO resource_deltas
               (session_id, arc_id, mission_id, player_id, character_id,
                actor_name, registered_by, source,
                resource_type, delta, description, out_of_session, occurred_at)
             SELECT
               NULL, $1, $2, $3, $4,
               pc.name, $5, 'system',
               'gold', $6,
               'Recompensa de arco: ' || $7,
               TRUE, NOW()
             FROM player_characters pc WHERE pc.id = $4`,
            [arc.id, arc.mission_id, p.user_id, p.character_id,
             req.user.id, rewardGold, arc.title],
          );
        }
      }

      await query(
        `UPDATE mission_arcs SET rewards_distributed = TRUE, rewards_distributed_at = NOW()
         WHERE id = $1`,
        [arc.id],
      );
    }

    const updated = await fetchArc(arc.id, arc.mission_id);
    broadcast('ARC_CLOSED', serializeArc(updated));
    return serializeArc(updated);
  });

  // ── POST /arcs/:arcId/participants ─────────────────────────────────────────
  // Adiciona um personagem ao arco. Valida exclusividade (não pode estar em outro arco ativo).
  fastify.post('/arcs/:arcId/participants', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const { arcId } = req.params;
    if (!isUuid(arcId)) return bad(reply, 'arcId inválido.');

    const arc = await fetchArc(arcId, null);
    if (!arc) return notFound(reply, 'Arco não encontrado.');
    if (arc.status !== 'active') return bad(reply, 'Arco não está ativo.');

    const { characterId, type = 'PLAYER' } = req.body ?? {};
    if (!characterId || !isUuid(characterId)) return bad(reply, 'characterId é obrigatório e deve ser um UUID.');

    // Busca o personagem
    const charRes = await query(
      `SELECT pc.*, COALESCE(u.display_name, u.name) AS player_name
       FROM player_characters pc
       LEFT JOIN users u ON u.id = pc.user_id
       WHERE pc.id = $1 AND pc.active = TRUE AND pc.dead = FALSE AND pc.retired = FALSE`,
      [characterId],
    );
    if (!charRes.rows.length) {
      return bad(reply, 'Personagem não encontrado ou inativo/morto/aposentado.');
    }
    const char = charRes.rows[0];
    if (!char.user_id) return bad(reply, 'Personagem não está vinculado a nenhum jogador.');

    // Verifica conflito de arco ativo
    const conflictRes = await query(
      'SELECT * FROM fn_check_character_arc_conflict($1, $2)',
      [characterId, arcId],
    );
    if (conflictRes.rows.length > 0) {
      const c = conflictRes.rows[0];
      return reply.code(409).send({
        error: `Este personagem já participa do arco "${c.conflict_arc_title}" da missão "${c.mission_title}". ` +
               `Um personagem não pode estar em dois arcos ativos simultaneamente.`,
      });
    }

    const res = await query(
      `INSERT INTO arc_participants (arc_id, mission_id, character_id, user_id, type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (arc_id, character_id) DO UPDATE SET left_at = NULL, type = EXCLUDED.type
       RETURNING *`,
      [arcId, arc.mission_id, characterId, char.user_id, type],
    );

    broadcast('ARC_PARTICIPANT_ADDED', { arcId, participant: serializeParticipant({ ...res.rows[0], character_name: char.name, player_name: char.player_name, token_img: char.token_img, level: char.level }) });
    return reply.code(201).send(serializeParticipant({ ...res.rows[0], character_name: char.name, player_name: char.player_name, token_img: char.token_img, level: char.level }));
  });

  // ── GET /arcs/:arcId/participants ──────────────────────────────────────────
  fastify.get('/arcs/:arcId/participants', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const { arcId } = req.params;
    if (!isUuid(arcId)) return bad(reply, 'arcId inválido.');

    const res = await query(
      `SELECT ap.*,
              pc.name  AS character_name,
              pc.token_img,
              pc.level,
              COALESCE(u.display_name, u.name) AS player_name
       FROM arc_participants ap
       INNER JOIN player_characters pc ON pc.id = ap.character_id
       INNER JOIN users u              ON u.id  = ap.user_id
       WHERE ap.arc_id = $1
       ORDER BY ap.joined_at ASC`,
      [arcId],
    );
    return res.rows.map(serializeParticipant);
  });

  // ── DELETE /arcs/:arcId/participants/:characterId ──────────────────────────
  fastify.delete('/arcs/:arcId/participants/:characterId', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const { arcId, characterId } = req.params;
    if (!isUuid(arcId) || !isUuid(characterId)) return bad(reply, 'IDs inválidos.');

    await query(
      `UPDATE arc_participants SET left_at = NOW()
       WHERE arc_id = $1 AND character_id = $2 AND left_at IS NULL`,
      [arcId, characterId],
    );
    broadcast('ARC_PARTICIPANT_REMOVED', { arcId, characterId });
    return { removed: true };
  });

  // ── GET /arcs/:arcId/timeline ──────────────────────────────────────────────
  // Lista sessões e contagem de eventos do arco, ordenados cronologicamente.
  fastify.get('/arcs/:arcId/timeline', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;
    const { arcId } = req.params;
    if (!isUuid(arcId)) return bad(reply, 'arcId inválido.');

    const sessions = await query(
      `SELECT sl.*,
              COALESCE(gm.display_name, gm.name) AS primary_gm_name,
              COUNT(DISTINCT rd.id)               AS event_count,
              COUNT(DISTINCT rd.id) FILTER (WHERE rd.out_of_session = TRUE) AS out_of_session_count
       FROM session_logs sl
       LEFT JOIN users gm           ON gm.id = sl.primary_gm_id
       LEFT JOIN resource_deltas rd ON rd.session_id = sl.id AND rd.deleted_at IS NULL
       WHERE sl.arc_id = $1 AND sl.deleted_at IS NULL
       GROUP BY sl.id, gm.id, gm.display_name, gm.name
       ORDER BY sl.started_at ASC`,
      [arcId],
    );

    return sessions.rows.map(s => ({
      id:                 s.id,
      title:              s.title,
      status:             s.status,
      startedAt:          s.started_at,
      closedAt:           s.closed_at        ?? null,
      sessionNumber:      s.session_number   ?? null,
      primaryGmName:      s.primary_gm_name  ?? null,
      eventCount:         Number(s.event_count),
      outOfSessionCount:  Number(s.out_of_session_count),
    }));
  });
}
