/**
 * routes/calendar.js
 *
 * Módulo: Calendário do Mundo (MVP - Etapa 1)
 *
 * Rotas:
 *  GET  /world/calendar          — estado atual + efeitos da estação corrente
 *  GET  /world/calendar/history  — trilha de auditoria (GM only)
 *  POST /world/calendar/next     — avança 1 sessão (GM only)
 *  POST /world/calendar/previous — volta 1 sessão (GM only)
 *  POST /world/calendar/session  — define a sessão manualmente (GM only)
 *
 * Efeitos mecânicos de estação (CRUD) ficam em routes/seasonEffects.js.
 *
 * Fora de escopo nesta etapa (ver spec): integração Foundry, clima,
 * economia automática, eventos sazonais, feriados, calendário por campanha.
 * "Data oficial do mundo por sessão" (dia da Lua) está modelado mas aguarda
 * definição dos nomes das Luas.
 */

import { requireGM } from '../lib/roles.js';
import { broadcast } from '../ws/broadcast.js';
import {
  getCalendarState,
  getCalendarHistory,
  advanceSession,
  rewindSession,
  setSession,
  getSeasonKey,
  CalendarError,
} from '../services/calendarService.js';
import { listEffectsBySeason } from '../services/seasonEffectsService.js';

async function withCurrentEffects(state) {
  const effects = await listEffectsBySeason(getSeasonKey(state.season));
  return { ...state, effects };
}

function handleCalendarError(err, reply) {
  if (err instanceof CalendarError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  throw err;
}

export async function calendarRoutes(fastify) {

  // ── GET /world/calendar — todos os usuários autenticados podem ver ────────
  fastify.get('/world/calendar', async (req, reply) => {
    try {
      const state = await getCalendarState();
      return await withCurrentEffects(state);
    } catch (err) {
      return handleCalendarError(err, reply);
    }
  });

  // ── GET /world/calendar/history — apenas GM ────────────────────────────────
  fastify.get('/world/calendar/history', async (req, reply) => {
    if (!requireGM(req, reply)) return;
    const limit = Math.min(parseInt(req.query?.limit) || 50, 200);
    const history = await getCalendarHistory(limit);
    return history;
  });

  // ── POST /world/calendar/next — apenas GM ──────────────────────────────────
  fastify.post('/world/calendar/next', async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      const state = await withCurrentEffects(await advanceSession(req.user.id));
      broadcast('CALENDAR_UPDATED', state);
      return state;
    } catch (err) {
      return handleCalendarError(err, reply);
    }
  });

  // ── POST /world/calendar/previous — apenas GM ───────────────────────────────
  fastify.post('/world/calendar/previous', async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      const state = await withCurrentEffects(await rewindSession(req.user.id));
      broadcast('CALENDAR_UPDATED', state);
      return state;
    } catch (err) {
      return handleCalendarError(err, reply);
    }
  });

  // ── POST /world/calendar/session — apenas GM (correção administrativa) ─────
  fastify.post('/world/calendar/session', {
    schema: {
      body: {
        type: 'object',
        required: ['session'],
        properties: {
          session: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (req, reply) => {
    if (!requireGM(req, reply)) return;
    try {
      const state = await withCurrentEffects(await setSession(req.body.session, req.user.id));
      broadcast('CALENDAR_UPDATED', state);
      return state;
    } catch (err) {
      return handleCalendarError(err, reply);
    }
  });
}
