/**
 * routes/seasonEffects.js
 *
 * Módulo: Efeitos mecânicos de estação (customizáveis pelo GM)
 *
 * GET    /world/calendar/effects            — todas as estações (todos)
 * GET    /world/calendar/effects/:seasonKey — uma estação (todos)
 * POST   /world/calendar/effects            — cria (GM only)
 * PATCH  /world/calendar/effects/:id        — edita (GM only)
 * DELETE /world/calendar/effects/:id        — remove (GM only)
 * POST   /world/calendar/effects/:id/move   — reordena (GM only)
 */

import { requireGM } from '../lib/roles.js';
import { broadcast } from '../ws/broadcast.js';
import { CalendarError } from '../services/calendarService.js';
import {
  listAllEffects,
  listEffectsBySeason,
  createEffect,
  updateEffect,
  deleteEffect,
  moveEffect,
} from '../services/seasonEffectsService.js';

function handleError(err, reply) {
  if (err instanceof CalendarError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  throw err;
}

export async function seasonEffectsRoutes(fastify) {

  fastify.get('/world/calendar/effects', async (req, reply) => {
    try {
      return await listAllEffects();
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.get('/world/calendar/effects/:seasonKey', async (req, reply) => {
    try {
      return await listEffectsBySeason(req.params.seasonKey);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.post('/world/calendar/effects', async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      const effect = await createEffect(req.body || {}, req.user.id);
      broadcast('SEASON_EFFECTS_UPDATED', { seasonKey: effect.seasonKey });
      reply.code(201);
      return effect;
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.patch('/world/calendar/effects/:id', async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      const effect = await updateEffect(req.params.id, req.body || {}, req.user.id);
      broadcast('SEASON_EFFECTS_UPDATED', { seasonKey: effect.seasonKey });
      return effect;
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.delete('/world/calendar/effects/:id', async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      await deleteEffect(req.params.id);
      broadcast('SEASON_EFFECTS_UPDATED', {});
      return { success: true };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.post('/world/calendar/effects/:id/move', {
    schema: {
      body: {
        type: 'object',
        required: ['direction'],
        properties: { direction: { type: 'string', enum: ['up', 'down'] } },
      },
    },
  }, async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      const list = await moveEffect(req.params.id, req.body.direction);
      if (list.length > 0) {
        broadcast('SEASON_EFFECTS_UPDATED', { seasonKey: list[0].seasonKey });
      }
      return list;
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
