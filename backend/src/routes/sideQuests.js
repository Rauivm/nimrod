/**
 * routes/sideQuests.js
 *
 * Endpoints REST para o módulo de Side Quests (e atividades genéricas futuras).
 *
 * Endpoints:
 *   POST   /sidequests                 — GM: criar nova Side Quest
 *   GET    /sidequests                 — Autenticado: listar (filtros: status, type)
 *   GET    /sidequests/:id             — Autenticado: detalhe + participants
 *   POST   /sidequests/:id/join        — PLAYER: inscrever personagem
 *   POST   /sidequests/:id/cancel      — GM: cancelar
 *   POST   /sidequests/:id/finish      — GM: encerrar + gerar recompensas
 *   GET    /sidequests/:id/report      — Autenticado: relatório final (JSONB)
 *
 * Guards de role:
 *   requireGM   → role IN ('GM', 'GM_PRINCIPAL')
 *   requireAuth → qualquer usuário autenticado (req.user injetado pelo cfAuthMiddleware)
 *
 * Erros de negócio são lançados como Error com .statusCode pelo ActivityEngine.
 * O errorHandler global do Fastify (index.js) trata esses erros.
 */

import { ActivityEngine } from '../services/activityEngine.js';
import { requireGM, requireAuth } from '../lib/roles.js';
import { ManaAccess } from '../services/manaAccess.js';

export async function sideQuestRoutes(fastify) {
  fastify.post('/sidequests/:id/launch', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['character_id'], additionalProperties: false,
        properties: { character_id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;
    return ManaAccess.launch(req.user, req.params.id, req.body.character_id);
  });

  // ── POST /sidequests ───────────────────────────────────────────────────────

  fastify.post('/sidequests', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    const activity = await ActivityEngine.create(req.user, req.body);
    return reply.code(201).send(activity);
  });

  // ── GET /sidequests ────────────────────────────────────────────────────────

  fastify.get('/sidequests', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;

    const { status, type, limit, offset } = req.query;
    const activities = await ActivityEngine.list({
      status,
      activityType: type,
      limit:  parseInt(limit)  || 50,
      offset: parseInt(offset) || 0,
    });

    return reply.send(activities);
  });

  // ── GET /sidequests/:id ────────────────────────────────────────────────────

  fastify.get('/sidequests/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;

    const { activity, participants } = await ActivityEngine.findById(req.params.id);
    return reply.send({ ...activity, participants });
  });

  // ── POST /sidequests/:id/join ──────────────────────────────────────────────

  fastify.post('/sidequests/:id/join', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;

    const { character_id } = req.body ?? {};
    if (!character_id) {
      return reply.code(400).send({ error: 'character_id é obrigatório.' });
    }

    const participant = await ActivityEngine.join(req.user, req.params.id, character_id);
    return reply.send(participant);
  });

  // ── POST /sidequests/:id/cancel ────────────────────────────────────────────

  fastify.post('/sidequests/:id/cancel', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    const activity = await ActivityEngine.cancel(req.user, req.params.id);
    return reply.send(activity);
  });

  // ── POST /sidequests/:id/finish ────────────────────────────────────────────

  fastify.post('/sidequests/:id/finish', async (req, reply) => {
    if (!requireGM(req, reply)) return reply;

    const result = await ActivityEngine.finish(req.user, req.params.id);
    return reply.send(result);
  });

  // ── GET /sidequests/:id/report ─────────────────────────────────────────────

  fastify.get('/sidequests/:id/report', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;

    const result = await ActivityEngine.getReport(req.params.id);
    return reply.send(result);
  });
}
