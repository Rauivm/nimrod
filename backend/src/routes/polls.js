import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';
import { notifyPollCreated } from '../services/notifier/notifier.js';

async function getPollWithOptions(pollId, userId) {
  const poll = await query(
    `SELECT p.*, COALESCE(u.display_name, u.name) AS creator_name,
            (SELECT option_id FROM poll_votes WHERE poll_id = p.id AND user_id = $2) as my_vote_option_id,
            (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes
     FROM polls p
     JOIN users u ON u.id = p.creator_id
     WHERE p.id = $1`,
    [pollId, userId]
  );
  if (!poll.rows.length) return null;

  const options = await query(
    'SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY id',
    [pollId]
  );

  return { ...poll.rows[0], options: options.rows };
}

export async function pollRoutes(fastify) {
  // GET /polls
  fastify.get('/polls', async (req) => {
    const polls = await query(
      `SELECT p.*, COALESCE(u.display_name, u.name) AS creator_name,
              (SELECT option_id FROM poll_votes WHERE poll_id = p.id AND user_id = $1) as my_vote_option_id,
              (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) as total_votes
       FROM polls p
       JOIN users u ON u.id = p.creator_id
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    const pollIds = polls.rows.map(p => p.id);
    if (!pollIds.length) return [];

    const options = await query(
      `SELECT * FROM poll_options WHERE poll_id = ANY($1) ORDER BY poll_id, id`,
      [pollIds]
    );

    return polls.rows.map(p => ({
      ...p,
      options: options.rows.filter(o => o.poll_id === p.id),
    }));
  });

  // POST /polls
  fastify.post('/polls', {
    schema: {
      body: {
        type: 'object',
        required: ['question', 'options'],
        properties: {
          question: { type: 'string', minLength: 1 },
          options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { question, options } = req.body;

    const pollRes = await query(
      'INSERT INTO polls (creator_id, question) VALUES ($1, $2) RETURNING *',
      [req.user.id, question]
    );
    const poll = pollRes.rows[0];

    for (const text of options) {
      await query(
        'INSERT INTO poll_options (poll_id, text) VALUES ($1, $2)',
        [poll.id, text.trim()]
      );
    }

    const full = await getPollWithOptions(poll.id, req.user.id);
    broadcast('POLL_CREATED', full);
    notifyPollCreated(full).catch(() => {});
    return reply.code(201).send(full);
  });

  // POST /polls/:id/vote
  fastify.post('/polls/:id/vote', {
    schema: {
      body: {
        type: 'object',
        required: ['optionId'],
        properties: { optionId: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    const { optionId } = req.body;

    // Verify option belongs to this poll
    const opt = await query(
      'SELECT * FROM poll_options WHERE id = $1 AND poll_id = $2',
      [optionId, id]
    );
    if (!opt.rows.length) return reply.code(400).send({ error: 'Invalid option' });

    // Check existing vote
    const existing = await query(
      'SELECT option_id FROM poll_votes WHERE user_id = $1 AND poll_id = $2',
      [req.user.id, id]
    );

    if (existing.rows.length) {
      const oldOptionId = existing.rows[0].option_id;
      if (oldOptionId === optionId) {
        // Same option → no-op
        const full = await getPollWithOptions(id, req.user.id);
        return full;
      }
      // Change vote: decrement old, increment new
      await query(
        'UPDATE poll_options SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = $1',
        [oldOptionId]
      );
      await query(
        'UPDATE poll_votes SET option_id = $1 WHERE user_id = $2 AND poll_id = $3',
        [optionId, req.user.id, id]
      );
    } else {
      // New vote
      await query(
        'INSERT INTO poll_votes (user_id, poll_id, option_id) VALUES ($1, $2, $3)',
        [req.user.id, id, optionId]
      );
    }

    await query(
      'UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = $1',
      [optionId]
    );

    const full = await getPollWithOptions(id, req.user.id);
    broadcast('POLL_UPDATED', full);
    return full;
  });

  // DELETE /polls/:id (creator only)
  fastify.delete('/polls/:id', async (req, reply) => {
    const res = await query(
      'DELETE FROM polls WHERE id = $1 AND creator_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found or not authorized' });
    broadcast('POLL_DELETED', { pollId: req.params.id });
    return { deleted: true };
  });
}
