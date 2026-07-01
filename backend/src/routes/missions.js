import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { notifyMissionCreated, notifyNoticeCreated } from '../services/notifier/notifier.js';
import { assertRateLimit } from '../middleware/rateLimit.js';
import { isGM, isGMPrincipal, isAdmin, requireGM, requireGMPrincipal, requireAdmin } from '../lib/roles.js';

function currentDateValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isValidDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeMissionDateTime({ datetime, date, time }) {
  let resolvedDate = String(date || '').trim();
  let resolvedTime = String(time || '').trim();

  if (datetime && (!resolvedDate || !resolvedTime)) {
    const match = String(datetime).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
    if (!match) throw new Error('datetime must use YYYY-MM-DDTHH:MM');
    resolvedDate ||= match[1];
    resolvedTime ||= match[2];
  }

  resolvedDate ||= currentDateValue();
  resolvedTime ||= '20:00';

  if (!isValidDateValue(resolvedDate)) throw new Error('date must use a valid YYYY-MM-DD value');
  if (!isValidTimeValue(resolvedTime)) throw new Error('time must use a valid HH:MM value');

  return `${resolvedDate}T${resolvedTime}`;
}

async function getMissionWithCounts(missionId, userId) {
  const res = await query(
    `SELECT m.*,
            COALESCE(u.display_name, u.name) AS creator_name,
            COUNT(CASE WHEN mp.type = 'PLAYER' THEN 1 END) as player_count,
            COUNT(CASE WHEN mp.type = 'RESERVE' THEN 1 END) as reserve_count,
            EXISTS(SELECT 1 FROM mission_participants WHERE mission_id = m.id AND user_id = $2) as user_joined,
            (SELECT type FROM mission_participants WHERE mission_id = m.id AND user_id = $2) as user_type,
            EXISTS (
              SELECT 1 FROM mission_participants
              WHERE mission_id = m.id AND user_id = $2 AND type = 'RESERVE'
            ) AS user_is_reserve,
            ROUND(AVG(mr.stars), 1) as avg_rating,
            COUNT(mr.stars) as rating_count
     FROM missions m
     JOIN users u ON u.id = m.creator_id
     LEFT JOIN mission_participants mp ON mp.mission_id = m.id
     LEFT JOIN mission_ratings mr ON mr.mission_id = m.id
     WHERE m.id = $1
     GROUP BY m.id, u.id, u.name, u.display_name`,
    [missionId, userId]
  );
  if (!res.rows[0]) return null;

  const reactions = await getReactions(missionId, userId);
  let poll = null;
  if (res.rows[0].poll_id) {
    poll = await getPollForMission(res.rows[0].poll_id, userId);
  }

  const [mission] = await attachMissionRuntime([{ ...res.rows[0], reactions, poll }], userId);
  return mission;
}

function serializeSessionSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    arcId: row.arc_id ?? null,
    missionId: row.mission_id ?? null,
    title: row.title,
    sessionNumber: row.session_number ?? null,
    status: row.status,
    startedAt: row.started_at,
    closedAt: row.closed_at ?? null,
    eventCount: row.event_count != null ? Number(row.event_count) : 0,
  };
}

async function attachMissionRuntime(missions, userId) {
  if (!missions.length) return missions;
  const ids = missions.map(m => m.id);

  let participantRows = [];
  try {
    const res = await query(
      `SELECT
         mp.mission_id,
         mp.user_id,
         mp.type,
         mp.invited,
         mp.joined_at,
         u.role,
         COALESCE(u.display_name, u.name) AS player_name,
         pc.id AS character_id,
         pc.name AS character_name,
         pc.level,
         pc.token_img,
         pc.portrait_img,
         pc.active,
         pc.retired,
         pc.dead
       FROM mission_participants mp
       JOIN users u ON u.id = mp.user_id
       LEFT JOIN player_characters pc ON pc.id = mp.character_id
       WHERE mp.mission_id = ANY($1)
       ORDER BY mp.type ASC, mp.joined_at ASC`,
      [ids],
    );
    participantRows = res.rows;
  } catch {
    participantRows = [];
  }

  let sessionRows = [];
  try {
    const res = await query(
      `SELECT
         COALESCE(sl.mission_id, ma.mission_id) AS resolved_mission_id,
         sl.*,
         COUNT(rd.id) AS event_count
       FROM session_logs sl
       LEFT JOIN mission_arcs ma ON ma.id = sl.arc_id
       LEFT JOIN resource_deltas rd ON rd.session_id = sl.id AND rd.deleted_at IS NULL
       WHERE sl.deleted_at IS NULL
         AND (sl.mission_id = ANY($1) OR ma.mission_id = ANY($1))
       GROUP BY sl.id, ma.mission_id
       ORDER BY sl.started_at DESC`,
      [ids],
    );
    sessionRows = res.rows;
  } catch {
    sessionRows = [];
  }

  const participantsByMission = new Map();
  for (const row of participantRows) {
    const list = participantsByMission.get(row.mission_id) ?? [];
    list.push({
      userId: row.user_id,
      type: row.type,
      invited: row.invited ?? false,
      joinedAt: row.joined_at,
      playerName: row.player_name,
      role: row.role,
      isGM: isGM({ role: row.role }),
      characterId: row.character_id ?? null,
      characterName: row.character_name ?? row.player_name,
      level: row.level ?? null,
      tokenImg: row.token_img ?? null,
      portraitImg: row.portrait_img ?? null,
      active: row.active ?? true,
      retired: row.retired ?? false,
      dead: row.dead ?? false,
    });
    participantsByMission.set(row.mission_id, list);
  }

  const sessionsByMission = new Map();
  for (const row of sessionRows) {
    const missionId = row.resolved_mission_id;
    if (!missionId) continue;
    const state = sessionsByMission.get(missionId) ?? { active: null, last: null };
    if (!state.last) state.last = row;
    if (!state.active && row.status === 'open') state.active = row;
    sessionsByMission.set(missionId, state);
  }

  return missions.map(m => {
    const sessionState = sessionsByMission.get(m.id) ?? {};
    return {
      ...m,
      participants: participantsByMission.get(m.id) ?? [],
      activeSession: serializeSessionSummary(sessionState.active),
      lastSession: serializeSessionSummary(sessionState.last),
      sessionStatus: sessionState.active ? 'open' : sessionState.last ? sessionState.last.status : null,
    };
  });
}

async function getReactions(missionId, userId) {
  try {
    const res = await query(
      `SELECT emoji,
              COUNT(*) as count,
              COUNT(*) FILTER (WHERE user_id = $2) > 0 as reacted_by_me
       FROM mission_reactions
       WHERE mission_id = $1
       GROUP BY emoji
       ORDER BY count DESC`,
      [missionId, userId]
    );
    return res.rows;
  } catch {
    return [];
  }
}

async function getPollForMission(pollId, userId) {
  try {
    const poll = await query(
      `SELECT p.*, COALESCE(u.display_name, u.name) AS creator_name,
              (SELECT option_id FROM poll_votes WHERE poll_id = p.id AND user_id = $2) as my_vote_option_id,
              (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes
       FROM polls p JOIN users u ON u.id = p.creator_id WHERE p.id = $1`,
      [pollId, userId]
    );
    if (!poll.rows.length) return null;
    const opts = await query('SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY id', [pollId]);
    return { ...poll.rows[0], options: opts.rows };
  } catch {
    return null;
  }
}

export async function missionRoutes(fastify) {
  // GET /missions
  fastify.get('/missions', async (req) => {
    const { status, kind, before } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 30, 60);
    let sql = `
      SELECT m.*,
             COALESCE(u.display_name, u.name) AS creator_name,
             COUNT(CASE WHEN mp.type = 'PLAYER' THEN 1 END) as player_count,
             COUNT(CASE WHEN mp.type = 'RESERVE' THEN 1 END) as reserve_count,
             EXISTS(SELECT 1 FROM mission_participants mp2 WHERE mp2.mission_id = m.id AND mp2.user_id = $1) as user_joined,
             EXISTS (
               SELECT 1 FROM mission_participants
               WHERE mission_id = m.id AND user_id = $1 AND type = 'RESERVE'
             ) AS user_is_reserve,
             ROUND(AVG(mr.stars), 1) as avg_rating
      FROM missions m
      JOIN users u ON u.id = m.creator_id
      LEFT JOIN mission_participants mp ON mp.mission_id = m.id
      LEFT JOIN mission_ratings mr ON mr.mission_id = m.id
    `;
    const params = [req.user.id];
    const where = [];

    if (status) {
      const statuses = status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (statuses.length === 1) {
        params.push(statuses[0]); where.push(`m.status = $${params.length}`);
      } else {
        params.push(statuses); where.push(`m.status = ANY($${params.length})`);
      }
    }
    if (kind)   { params.push(kind.toUpperCase());   where.push(`m.kind = $${params.length}`); }
    if (before) { params.push(before); where.push(`m.created_at < $${params.length}`); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');

    params.push(limit);
    sql += ` GROUP BY m.id, u.id, u.name, u.display_name ORDER BY m.created_at DESC LIMIT $${params.length}`;
    const res = await query(sql, params);
    if (!res.rows.length) return [];

    const ids = res.rows.map(r => r.id);

    // Reactions — safe fallback if table doesn't exist yet
    let rxRows = [];
    try {
      const rxRes = await query(
        `SELECT mission_id, emoji,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE user_id = $2) > 0 as reacted_by_me
         FROM mission_reactions
         WHERE mission_id = ANY($1)
         GROUP BY mission_id, emoji
         ORDER BY count DESC`,
        [ids, req.user.id]
      );
      rxRows = rxRes.rows;
    } catch { /* table not migrated yet */ }

    // Polls — safe fallback
    const pollIds = res.rows.map(r => r.poll_id).filter(Boolean);
    let polls = [];
    if (pollIds.length) {
      try {
        const pRes = await query(
          `SELECT p.*,
                  (SELECT option_id FROM poll_votes WHERE poll_id = p.id AND user_id = $2) as my_vote_option_id,
                  (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes
           FROM polls p WHERE p.id = ANY($1)`,
          [pollIds, req.user.id]
        );
        const optRes = await query(
          'SELECT * FROM poll_options WHERE poll_id = ANY($1) ORDER BY poll_id, id',
          [pollIds]
        );
        polls = pRes.rows.map(p => ({
          ...p,
          options: optRes.rows.filter(o => o.poll_id === p.id),
        }));
      } catch { /* polls not migrated yet */ }
    }

    const missions = res.rows.map(m => ({
      ...m,
      reactions: rxRows.filter(r => r.mission_id === m.id),
      poll: polls.find(p => p.id === m.poll_id) || null,
    }));
    return attachMissionRuntime(missions, req.user.id);
  });

  // GET /missions/:id
  fastify.get('/missions/:id', async (req, reply) => {
    const mission = await getMissionWithCounts(req.params.id, req.user.id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found' });

    const participants = await query(
      `SELECT mp.*, COALESCE(u.display_name, u.name) AS name, u.role
       FROM mission_participants mp JOIN users u ON u.id = mp.user_id
       WHERE mp.mission_id = $1 ORDER BY mp.joined_at ASC`,
      [req.params.id]
    );
    return { ...mission, participants: participants.rows };
  });

  // POST /missions — kind-aware, datetime optional for NOTICE
  fastify.post('/missions', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'missions:create', { limit: 6, windowMs: 60_000 })) return reply;
    const {
      kind,
      title,
      description,
      datetime,
      date,
      time,
      reward,
      level,
      maxPlayers,
      maxReserves,
      pollQuestion,
      pollOptions,
    } = req.body || {};

    // Manual validation
    if (!title?.trim())       return reply.code(400).send({ error: 'title is required' });
    if (!description?.trim()) return reply.code(400).send({ error: 'description is required' });

    const resolvedKind = (kind === 'NOTICE') ? 'NOTICE' : 'MISSION';

    let resolvedDateTime = null;
    if (resolvedKind === 'MISSION') {
      try {
        resolvedDateTime = normalizeMissionDateTime({ datetime, date, time });
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    }

    const resolvedMaxPlayers  = parseInt(maxPlayers)  || 4;
    const resolvedMaxReserves = parseInt(maxReserves) || 2;

    // Create linked poll if provided
    let pollId = null;
    const cleanOptions = (pollOptions || []).map(o => String(o).trim()).filter(Boolean);
    if (pollQuestion?.trim() && cleanOptions.length >= 2) {
      const pRes = await query(
        'INSERT INTO polls (creator_id, question) VALUES ($1, $2) RETURNING *',
        [req.user.id, pollQuestion.trim()]
      );
      pollId = pRes.rows[0].id;
      for (const text of cleanOptions) {
        await query('INSERT INTO poll_options (poll_id, text) VALUES ($1, $2)', [pollId, text]);
      }
    }

    const res = await query(
      `INSERT INTO missions
         (creator_id, kind, title, description, datetime, reward, level, max_players, max_reserves, poll_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        req.user.id,
        resolvedKind,
        title.trim(),
        description.trim(),
        resolvedDateTime,
        reward?.trim() || null,
        level?.trim()  || null,
        resolvedMaxPlayers,
        resolvedMaxReserves,
        pollId,
      ]
    );

    const mission = await getMissionWithCounts(res.rows[0].id, req.user.id);
    broadcast('MISSION_CREATED', mission);

    // Notify Discord — split by kind
    if (resolvedKind === 'NOTICE') {
      notifyNoticeCreated(mission);
    } else {
      notifyMissionCreated(mission);
    }

    return reply.code(201).send(mission);
  });

  // PATCH /missions/:id
  fastify.patch('/missions/:id', async (req, reply) => {
    const { id } = req.params;
    const existing = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Not found' });
    if (existing.rows[0].creator_id !== req.user.id && !isGM(req.user)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const updates = [];
    const values  = [];

    const fieldMap = {
      title: 'title', description: 'description',
      reward: 'reward', level: 'level',
      maxPlayers: 'max_players', maxReserves: 'max_reserves', status: 'status',
    };

    if (req.body.datetime !== undefined || req.body.date !== undefined || req.body.time !== undefined) {
      try {
        values.push(normalizeMissionDateTime({
          datetime: req.body.datetime,
          date: req.body.date,
          time: req.body.time,
        }));
        updates.push(`datetime = $${values.length}`);
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    }

    for (const [key, col] of Object.entries(fieldMap)) {
      if (req.body[key] !== undefined) {
        values.push(req.body[key]);
        updates.push(`${col} = $${values.length}`);
      }
    }

    if (!updates.length) return reply.code(400).send({ error: 'No fields to update' });

    values.push(id);
    await query(
      `UPDATE missions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
    const mission = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', mission);
    return mission;
  });

  // DELETE /missions/:id
  fastify.delete('/missions/:id', async (req, reply) => {
    const { id } = req.params;

    // Verify ownership before touching anything
    const check = await query(
      'SELECT id FROM missions WHERE id = $1 AND creator_id = $2',
      [id, req.user.id],
    );
    if (!check.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });

    // Remove dependent rows in order (FK RESTRICT chains):
    //   session_attendance → mission_arcs (via arc_participants) → missions
    await query(`DELETE FROM session_attendance WHERE mission_id = $1`, [id]);
    await query(`DELETE FROM arc_participants   WHERE mission_id = $1`, [id]);
    await query(
      `UPDATE mission_arcs SET deleted_at = NOW() WHERE mission_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    // mission_arcs rows are soft-deleted above; hard-delete them so the FK is cleared
    await query(`DELETE FROM mission_arcs WHERE mission_id = $1`, [id]);

    await query('DELETE FROM missions WHERE id = $1', [id]);

    broadcast('MISSION_DELETED', { missionId: id });
    return { deleted: true };
  });

  // POST /missions/:id/join
  fastify.post('/missions/:id/join', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'missions:join', { limit: 20, windowMs: 60_000 })) return reply;
    const { id } = req.params;
    const { characterId } = req.body ?? {};

    const mission = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!mission.rows.length) return reply.code(404).send({ error: 'Mission not found' });

    const m = mission.rows[0];
    if (m.status !== 'OPEN') return reply.code(400).send({ error: 'Mission is not open' });
    if (m.kind === 'NOTICE') return reply.code(400).send({ error: 'Cannot join a notice' });

    const existing = await query(
      'SELECT * FROM mission_participants WHERE mission_id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (existing.rows.length) return reply.code(400).send({ error: 'Already joined' });

    // Validate characterId if provided: must belong to this user
    let resolvedCharId = null;
    if (characterId) {
      const charRes = await query(
        'SELECT id FROM player_characters WHERE id = $1 AND user_id = $2 AND active = TRUE',
        [characterId, req.user.id]
      );
      if (!charRes.rows.length) {
        return reply.code(400).send({ error: 'Personagem inválido ou não pertence à sua conta' });
      }
      resolvedCharId = charRes.rows[0].id;
    }

    const counts = await query(
      `SELECT COUNT(CASE WHEN type = 'PLAYER' THEN 1 END) as players,
              COUNT(CASE WHEN type = 'RESERVE' THEN 1 END) as reserves
       FROM mission_participants WHERE mission_id = $1`,
      [id]
    );
    const { players, reserves } = counts.rows[0];

    let type;
    if (parseInt(players) < m.max_players) { type = 'PLAYER'; }
    else if (parseInt(reserves) < m.max_reserves) { type = 'RESERVE'; }
    else return reply.code(400).send({ error: 'Queue full' });

    await query(
      `INSERT INTO mission_participants (mission_id, user_id, type, character_id)
       VALUES ($1, $2, $3, $4)`,
      [id, req.user.id, type, resolvedCharId]
    );

    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { joined: true, type, mission: updated };
  });

  // ── POST /missions/:id/close-registrations ────────────────────────────────
  // Narrador fecha as inscrições: OPEN → CLOSED.
  fastify.post('/missions/:id/close-registrations', async (req, reply) => {
    const { id } = req.params;
    const missionRes = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!missionRes.rows.length) return reply.code(404).send({ error: 'Mission not found' });
    const mission = missionRes.rows[0];
    if (mission.creator_id !== req.user.id && !isGM(req.user)) return reply.code(403).send({ error: 'Forbidden' });
    if (mission.status !== 'OPEN') return reply.code(400).send({ error: `Status atual é ${mission.status}.` });
    await query(`UPDATE missions SET status = 'CLOSED', updated_at = NOW() WHERE id = $1`, [id]);
    const result = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', result);
    return result;
  });

  // ── POST /missions/:id/start ───────────────────────────────────────────────
  // Narrador inicia a campanha: OPEN|CLOSED → RUNNING.
  // Valida código do Foundry, cria sessão, vincula handshake, tudo em um passo.
  // Body: { code }
  fastify.post('/missions/:id/start', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'missions:start', { limit: 10, windowMs: 60_000 })) return reply;
    const { id } = req.params;

    const missionRes = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!missionRes.rows.length) return reply.code(404).send({ error: 'Mission not found' });
    const mission = missionRes.rows[0];
    if (mission.kind === 'NOTICE') return reply.code(400).send({ error: 'Avisos não têm sessão.' });
    if (mission.creator_id !== req.user.id && !isGM(req.user)) return reply.code(403).send({ error: 'Forbidden' });
    if (!['OPEN', 'CLOSED'].includes(mission.status)) {
      return reply.code(400).send({ error: `Missão está ${mission.status} — só OPEN ou CLOSED podem ser iniciadas.` });
    }

    const { code } = req.body ?? {};
    if (!code?.trim()) return reply.code(400).send({ error: 'Código do Foundry é obrigatório.' });
    const normalizedCode = code.trim().toUpperCase();

    const hsRes = await query(`SELECT * FROM foundry_handshakes WHERE code = $1`, [normalizedCode]);
    if (!hsRes.rows.length) return reply.code(400).send({ error: 'Código não encontrado. Verifique o painel Nimrod no Foundry.' });
    const hs = hsRes.rows[0];
    if (hs.claimed_at && hs.mission_id && hs.mission_id !== id) {
      return reply.code(400).send({ error: 'Código já utilizado para outra missão.' });
    }

    // Reutiliza sessão aberta se existir
    const existingSession = await query(
      `SELECT sl.*, COUNT(rd.id) AS event_count FROM session_logs sl
       LEFT JOIN resource_deltas rd ON rd.session_id = sl.id AND rd.deleted_at IS NULL
       WHERE sl.deleted_at IS NULL AND sl.status = 'open' AND sl.mission_id = $1
       GROUP BY sl.id ORDER BY sl.started_at DESC LIMIT 1`,
      [id],
    );

    let session;
    if (existingSession.rows.length) {
      session = serializeSessionSummary(existingSession.rows[0]);
    } else {
      // Cria arc se não existir
      let arcRes = await query(
        `SELECT * FROM mission_arcs WHERE mission_id = $1 AND status = 'active' AND deleted_at IS NULL ORDER BY arc_number DESC LIMIT 1`,
        [id],
      );
      if (!arcRes.rows.length) {
        const nextNum = await query(
          'SELECT COALESCE(MAX(arc_number), 0) + 1 AS next_num FROM mission_arcs WHERE mission_id = $1 AND deleted_at IS NULL',
          [id],
        );
        arcRes = await query(
          `INSERT INTO mission_arcs (mission_id, title, arc_number, description, primary_gm_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [id, mission.title, nextNum.rows[0].next_num, mission.description ?? null, req.user.id],
        );
        broadcast('ARC_CREATED', { id: arcRes.rows[0].id, missionId: id, title: arcRes.rows[0].title, arcNumber: arcRes.rows[0].arc_number, status: arcRes.rows[0].status });
      }
      const arc = arcRes.rows[0];
      const sessionNumberRes = await query(
        `SELECT COALESCE(MAX(session_number), 0) + 1 AS next_num FROM session_logs WHERE mission_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      const participants = await query(
        `SELECT mp.user_id, u.role FROM mission_participants mp
         JOIN users u ON u.id = mp.user_id
         WHERE mp.mission_id = $1 AND mp.type = 'PLAYER' ORDER BY mp.joined_at ASC`,
        [id],
      );
      const playerIds   = participants.rows.map(p => p.user_id);
      const narratorIds = [req.user.id, ...participants.rows.filter(p => p.role === 'GM' || p.role === 'GM_PRINCIPAL').map(p => p.user_id)].filter((v,i,a) => a.indexOf(v)===i);
      const title = req.body?.title?.trim() || `Sessão ${sessionNumberRes.rows[0].next_num} — ${mission.title}`;
      const created = await query(
        `INSERT INTO session_logs (title, campaign, session_number, opened_by, primary_gm_id, narrator_ids, player_ids, arc_id, mission_id)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8) RETURNING *`,
        [title, mission.title, sessionNumberRes.rows[0].next_num, req.user.id, narratorIds, playerIds, arc.id, id],
      );
      session = serializeSessionSummary({ ...created.rows[0], event_count: 0 });
      broadcast('SESSION_CREATED', session);
    }

    // Vincula handshake — sem expires_at (válido durante toda a campanha)
    await query(
      `UPDATE foundry_handshakes SET session_id = $1, mission_id = $2, claimed_at = COALESCE(claimed_at, NOW()), claimed_by = $3, expires_at = NULL WHERE code = $4`,
      [session.id, id, req.user.id, normalizedCode],
    );

    // Missão → RUNNING
    await query(`UPDATE missions SET status = 'RUNNING', updated_at = NOW() WHERE id = $1`, [id]);
    broadcast('FOUNDRY_SESSION_LINKED', { sessionId: session.id, missionId: id, code: normalizedCode });
    const updatedMission = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updatedMission);
    return reply.code(201).send({ session, mission: updatedMission });
  });

  // ── POST /missions/:id/finish ──────────────────────────────────────────────
  // Narrador encerra a campanha: qualquer status → FINISHED.
  // Encerra sessão ativa, invalida handshake, registra saídas de presença.
  fastify.post('/missions/:id/finish', async (req, reply) => {
    const { id } = req.params;
    const missionRes = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!missionRes.rows.length) return reply.code(404).send({ error: 'Mission not found' });
    const mission = missionRes.rows[0];
    if (mission.creator_id !== req.user.id && !isGM(req.user)) return reply.code(403).send({ error: 'Forbidden' });
    if (mission.status === 'FINISHED') return reply.code(400).send({ error: 'Missão já finalizada.' });

    // Encerra sessão aberta
    const openSession = await query(
      `SELECT id FROM session_logs WHERE mission_id = $1 AND status = 'open' AND deleted_at IS NULL`,
      [id],
    );
    if (openSession.rows.length) {
      const sessionId = openSession.rows[0].id;
      await query(`UPDATE session_logs SET status = 'closed', closed_at = NOW() WHERE id = $1`, [sessionId]);
      await query(`UPDATE session_attendance SET left_at = NOW(), last_seen_at = NOW() WHERE session_id = $1 AND left_at IS NULL`, [sessionId]);
      broadcast('SESSION_CLOSED', { sessionId, missionId: id });
    }

    // Invalida handshake (marca expires_at = now para o módulo detectar via polling)
    await query(`UPDATE foundry_handshakes SET expires_at = NOW() WHERE mission_id = $1`, [id]);

    await query(`UPDATE missions SET status = 'FINISHED', updated_at = NOW() WHERE id = $1`, [id]);
    const updatedMission = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updatedMission);
    return updatedMission;
  });

  // DELETE /missions/:id/join
  fastify.delete('/missions/:id/join', async (req, reply) => {
    const { id } = req.params;
    await query('DELETE FROM mission_participants WHERE mission_id = $1 AND user_id = $2', [id, req.user.id]);
    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { left: true, mission: updated };
  });

  // POST /missions/:id/invite
  fastify.post('/missions/:id/invite', {
    schema: { body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (req, reply) => {
    if (!assertRateLimit(req, reply, 'missions:invite', { limit: 30, windowMs: 60_000 })) return reply;
    const { id } = req.params;
    const { userId } = req.body;
    const mission = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!mission.rows.length) return reply.code(404).send({ error: 'Not found' });
    if (mission.rows[0].creator_id !== req.user.id && !isGM(req.user)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    await query(
      `INSERT INTO mission_participants (mission_id, user_id, type, invited)
       VALUES ($1, $2, 'PLAYER', true) ON CONFLICT (mission_id, user_id) DO NOTHING`,
      [id, userId]
    );
    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return updated;
  });

  // POST /missions/:id/rate
  fastify.post('/missions/:id/rate', {
    schema: { body: { type: 'object', required: ['stars'], properties: { stars: { type: 'integer', minimum: 1, maximum: 5 } } } }
  }, async (req, reply) => {
    if (!assertRateLimit(req, reply, 'missions:rate', { limit: 20, windowMs: 60_000 })) return reply;
    const { id } = req.params;
    const { stars } = req.body;
    const mission = await query('SELECT status FROM missions WHERE id = $1', [id]);
    if (!mission.rows.length) return reply.code(404).send({ error: 'Not found' });
    if (mission.rows[0].status !== 'FINISHED') return reply.code(400).send({ error: 'Mission must be finished to rate' });
    const participated = await query('SELECT 1 FROM mission_participants WHERE mission_id = $1 AND user_id = $2', [id, req.user.id]);
    if (!participated.rows.length) return reply.code(403).send({ error: 'Must have participated to rate' });
    await query(
      `INSERT INTO mission_ratings (mission_id, user_id, stars) VALUES ($1, $2, $3)
       ON CONFLICT (mission_id, user_id) DO UPDATE SET stars = $3`,
      [id, req.user.id, stars]
    );
    return { rated: true };
  });

  // POST /missions/:id/react — toggle emoji reaction
  fastify.post('/missions/:id/react', {
    schema: {
      body: {
        type: 'object',
        required: ['emoji'],
        properties: { emoji: { type: 'string', maxLength: 8 } }
      }
    }
  }, async (req, reply) => {
    if (!assertRateLimit(req, reply, 'missions:react', { limit: 80, windowMs: 60_000 })) return reply;
    const { id } = req.params;
    const { emoji } = req.body;

    const exists = await query(
      'SELECT 1 FROM mission_reactions WHERE mission_id = $1 AND user_id = $2 AND emoji = $3',
      [id, req.user.id, emoji]
    );

    if (exists.rows.length) {
      await query(
        'DELETE FROM mission_reactions WHERE mission_id = $1 AND user_id = $2 AND emoji = $3',
        [id, req.user.id, emoji]
      );
    } else {
      await query(
        'INSERT INTO mission_reactions (mission_id, user_id, emoji) VALUES ($1, $2, $3)',
        [id, req.user.id, emoji]
      );
    }

    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { reactions: updated.reactions };
  });

  // POST /missions/:id/poll/vote — vote on attached poll
  fastify.post('/missions/:id/poll/vote', {
    schema: { body: { type: 'object', required: ['optionId'], properties: { optionId: { type: 'string' } } } }
  }, async (req, reply) => {
    const { id } = req.params;
    const { optionId } = req.body;

    const mission = await query('SELECT poll_id FROM missions WHERE id = $1', [id]);
    if (!mission.rows.length || !mission.rows[0].poll_id) {
      return reply.code(404).send({ error: 'No poll attached to this mission' });
    }
    const pollId = mission.rows[0].poll_id;

    const opt = await query('SELECT * FROM poll_options WHERE id = $1 AND poll_id = $2', [optionId, pollId]);
    if (!opt.rows.length) return reply.code(400).send({ error: 'Invalid option' });

    const existing = await query('SELECT option_id FROM poll_votes WHERE user_id = $1 AND poll_id = $2', [req.user.id, pollId]);

    if (existing.rows.length) {
      const old = existing.rows[0].option_id;
      if (old === optionId) {
        const updated = await getMissionWithCounts(id, req.user.id);
        return { poll: updated.poll };
      }
      await query('UPDATE poll_options SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = $1', [old]);
      await query('UPDATE poll_votes SET option_id = $1 WHERE user_id = $2 AND poll_id = $3', [optionId, req.user.id, pollId]);
    } else {
      await query('INSERT INTO poll_votes (user_id, poll_id, option_id) VALUES ($1, $2, $3)', [req.user.id, pollId, optionId]);
    }
    await query('UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = $1', [optionId]);

    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { poll: updated.poll };
  });
}