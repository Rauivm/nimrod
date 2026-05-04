import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';

async function getMissionWithCounts(missionId, userId) {
  const res = await query(
    `SELECT m.*,
            u.name as creator_name,
            COUNT(CASE WHEN mp.type = 'PLAYER' THEN 1 END) as player_count,
            COUNT(CASE WHEN mp.type = 'RESERVE' THEN 1 END) as reserve_count,
            EXISTS(SELECT 1 FROM mission_participants WHERE mission_id = m.id AND user_id = $2) as user_joined,
            (SELECT type FROM mission_participants WHERE mission_id = m.id AND user_id = $2) as user_type,
            ROUND(AVG(mr.stars), 1) as avg_rating,
            COUNT(mr.stars) as rating_count
     FROM missions m
     JOIN users u ON u.id = m.creator_id
     LEFT JOIN mission_participants mp ON mp.mission_id = m.id
     LEFT JOIN mission_ratings mr ON mr.mission_id = m.id
     WHERE m.id = $1
     GROUP BY m.id, u.name`,
    [missionId, userId]
  );
  if (!res.rows[0]) return null;

  const reactions = await getReactions(missionId, userId);
  let poll = null;
  if (res.rows[0].poll_id) {
    poll = await getPollForMission(res.rows[0].poll_id, userId);
  }

  return { ...res.rows[0], reactions, poll };
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
      `SELECT p.*, u.name as creator_name,
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
    const { status, kind } = req.query;
    let sql = `
      SELECT m.*,
             u.name as creator_name,
             COUNT(CASE WHEN mp.type = 'PLAYER' THEN 1 END) as player_count,
             COUNT(CASE WHEN mp.type = 'RESERVE' THEN 1 END) as reserve_count,
             EXISTS(SELECT 1 FROM mission_participants mp2 WHERE mp2.mission_id = m.id AND mp2.user_id = $1) as user_joined,
             ROUND(AVG(mr.stars), 1) as avg_rating
      FROM missions m
      JOIN users u ON u.id = m.creator_id
      LEFT JOIN mission_participants mp ON mp.mission_id = m.id
      LEFT JOIN mission_ratings mr ON mr.mission_id = m.id
    `;
    const params = [req.user.id];
    const where = [];

    if (status) { params.push(status.toUpperCase()); where.push(`m.status = $${params.length}`); }
    if (kind)   { params.push(kind.toUpperCase());   where.push(`m.kind = $${params.length}`); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');

    sql += ' GROUP BY m.id, u.name ORDER BY m.created_at DESC';
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

    return res.rows.map(m => ({
      ...m,
      reactions: rxRows.filter(r => r.mission_id === m.id),
      poll: polls.find(p => p.id === m.poll_id) || null,
    }));
  });

  // GET /missions/:id
  fastify.get('/missions/:id', async (req, reply) => {
    const mission = await getMissionWithCounts(req.params.id, req.user.id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found' });

    const participants = await query(
      `SELECT mp.*, u.name, u.email, u.role
       FROM mission_participants mp JOIN users u ON u.id = mp.user_id
       WHERE mp.mission_id = $1 ORDER BY mp.joined_at ASC`,
      [req.params.id]
    );
    return { ...mission, participants: participants.rows };
  });

  // POST /missions — kind-aware, datetime optional for NOTICE
  fastify.post('/missions', async (req, reply) => {
    const {
      kind,
      title,
      description,
      datetime,
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

    if (resolvedKind === 'MISSION' && !datetime) {
      return reply.code(400).send({ error: 'datetime is required for missions' });
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
        datetime || null,
        reward?.trim() || null,
        level?.trim()  || null,
        resolvedMaxPlayers,
        resolvedMaxReserves,
        pollId,
      ]
    );

    const mission = await getMissionWithCounts(res.rows[0].id, req.user.id);
    broadcast('MISSION_CREATED', mission);
    return reply.code(201).send(mission);
  });

  // PATCH /missions/:id
  fastify.patch('/missions/:id', async (req, reply) => {
    const { id } = req.params;
    const existing = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!existing.rows.length) return reply.code(404).send({ error: 'Not found' });
    if (existing.rows[0].creator_id !== req.user.id && req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const updates = [];
    const values  = [];

    const fieldMap = {
      title: 'title', description: 'description',
      datetime: 'datetime',
      reward: 'reward', level: 'level',
      maxPlayers: 'max_players', maxReserves: 'max_reserves', status: 'status',
    };

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
    const res = await query(
      'DELETE FROM missions WHERE id = $1 AND creator_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });
    broadcast('MISSION_DELETED', { missionId: id });
    return { deleted: true };
  });

  // POST /missions/:id/join
  fastify.post('/missions/:id/join', async (req, reply) => {
    const { id } = req.params;
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
      'INSERT INTO mission_participants (mission_id, user_id, type) VALUES ($1, $2, $3)',
      [id, req.user.id, type]
    );

    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { joined: true, type };
  });

  // DELETE /missions/:id/join
  fastify.delete('/missions/:id/join', async (req, reply) => {
    const { id } = req.params;
    await query('DELETE FROM mission_participants WHERE mission_id = $1 AND user_id = $2', [id, req.user.id]);
    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { left: true };
  });

  // POST /missions/:id/invite
  fastify.post('/missions/:id/invite', {
    schema: { body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (req, reply) => {
    const { id } = req.params;
    const { userId } = req.body;
    const mission = await query('SELECT * FROM missions WHERE id = $1', [id]);
    if (!mission.rows.length) return reply.code(404).send({ error: 'Not found' });
    if (mission.rows[0].creator_id !== req.user.id && req.user.role !== 'GM') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    await query(
      `INSERT INTO mission_participants (mission_id, user_id, type, invited)
       VALUES ($1, $2, 'PLAYER', true) ON CONFLICT (mission_id, user_id) DO NOTHING`,
      [id, userId]
    );
    const updated = await getMissionWithCounts(id, req.user.id);
    broadcast('MISSION_UPDATED', updated);
    return { invited: true };
  });

  // POST /missions/:id/rate
  fastify.post('/missions/:id/rate', {
    schema: { body: { type: 'object', required: ['stars'], properties: { stars: { type: 'integer', minimum: 1, maximum: 5 } } } }
  }, async (req, reply) => {
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
