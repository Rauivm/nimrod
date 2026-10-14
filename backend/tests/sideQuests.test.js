/**
 * tests/sideQuests.test.js
 *
 * Suite de integração para o módulo de Side Quests.
 * Usa mocks de banco de dados (vi.mock) e buildTestApp local para
 * não depender de uma conexão real com PostgreSQL.
 *
 * Coberturas:
 *   - GM cria Side Quest
 *   - Listagem e detalhes
 *   - Player inscreve personagem (com verificação de roll)
 *   - Duplicidade de inscrição (409)
 *   - Personagem morto/aposentado (403)
 *   - Player tenta criar (403)
 *   - GM encerra (gera reward_data e report)
 *   - GM cancela
 *   - Player tenta inscrever em atividade cancelada (403)
 *   - Contribuição capada ao remaining
 *   - Relatório acessível após FINISHED
 *   - Relatório indisponível antes de FINISHED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ── Mocks ────────────────────────────────────────────────────────────────────
// vi.mock é hoisted pelo Vitest, portanto os factories NÃO podem referenciar
// variáveis declaradas neste módulo. Usamos vi.fn() inline e depois
// recuperamos as referências via vi.mocked().

vi.mock('../src/db/index.js', () => {
  const mockClientQuery = vi.fn();
  const mockRelease     = vi.fn();
  const mockConnect     = vi.fn(() => ({ query: mockClientQuery, release: mockRelease }));
  return {
    query: vi.fn(),
    pool:  { connect: mockConnect },
  };
});

// Mock do event bus
vi.mock('../src/lib/events.js', () => ({
  emitActivityEvent: vi.fn(),
  activityEvents:    { on: vi.fn(), emit: vi.fn() },
}));

// Mock do WS broadcast
vi.mock('../src/ws/broadcast.js', () => ({
  broadcast: vi.fn(),
}));

// Imports depois dos mocks
import { query, pool } from '../src/db/index.js';
import { sideQuestRoutes } from '../src/routes/sideQuests.js';

// Helpers para acessar os mocks internos do pool
function getPoolMocks() {
  const mockConnect     = vi.mocked(pool.connect);
  // O cliente mockado é criado pelo factory acima; buscamos via chamada simulada
  const mockClientQuery = vi.fn();
  const mockRelease     = vi.fn();
  mockConnect.mockImplementation(() => ({ query: mockClientQuery, release: mockRelease }));
  return { mockConnect, mockClientQuery, mockRelease };
}

// ── Dados de teste ────────────────────────────────────────────────────────────

const GM_USER = {
  id:    'gm-user-id',
  email: 'gm@example.com',
  name:  'Game Master',
  role:  'GM',
};

const PLAYER_USER = {
  id:    'player-user-id',
  email: 'player@example.com',
  name:  'Player One',
  role:  'PLAYER',
};

const NOW      = new Date().toISOString();
const FUTURE   = new Date(Date.now() + 3600_000).toISOString(); // +1h
const PAST     = new Date(Date.now() - 3600_000).toISOString(); // -1h
const ACT_ID   = 'act-uuid-001';
const CHAR_ID  = 'char-uuid-001';
const PART_ID  = 'part-uuid-001';

const BASE_ACTIVITY = {
  id:                  ACT_ID,
  title:               'Caçada ao Dragão',
  description:         'Elimine o dragão da montanha',
  activity_type:       'SIDE_QUEST',
  status:              'WAITING',
  starts_at:           PAST,
  ends_at:             FUTURE,
  goal:                80,
  progress:            0,
  max_participants:    0,
  created_by:          GM_USER.id,
  rules:               { attribute: 'str', rewardFormula: 'proportional', rewardParameters: { xp_max: 200, gold_max: 50 } },
  rewards:             [],
  report:              null,
  report_generated_at: null,
  version:             1,
  created_at:          NOW,
  updated_at:          NOW,
};

const BASE_CHARACTER = {
  id:              CHAR_ID,
  name:            'Thorin',
  user_id:         PLAYER_USER.id,
  user_id_check:   PLAYER_USER.id,
  active:          true,
  retired:         false,
  dead:            false,
  abilities:       { str: 18, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
};

const BASE_PARTICIPANT = {
  id:                   PART_ID,
  activity_id:          ACT_ID,
  character_id:         CHAR_ID,
  character_name:       'Thorin',
  dice:                 15,
  modifier:             4,
  total:                19,
  contribution:         19,
  contribution_current: 0,
  status:               'JOINED',
  reward_data:          [],
  joined_at:            NOW,
};

// ── Helper: buildTestApp ──────────────────────────────────────────────────────

async function buildTestApp({ mockUser }) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _req, reply) => {
    reply.code(error.statusCode || 500).send({ error: error.message });
  });

  app.addHook('preHandler', async (req) => {
    req.user = mockUser;
  });

  await app.register(sideQuestRoutes);
  await app.ready();
  return app;
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('Side Quests — ciclo de vida completo', () => {
  let mockClientQuery;
  let mockRelease;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reinstalar o mock do cliente a cada teste para isolamento
    mockClientQuery = vi.fn();
    mockRelease     = vi.fn();
    vi.mocked(pool.connect).mockImplementation(() => ({
      query:   mockClientQuery,
      release: mockRelease,
    }));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /sidequests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sidequests', () => {
    it('GM cria uma Side Quest com sucesso — retorna 201 e id', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 });

      const app = await buildTestApp({ mockUser: GM_USER });
      const res = await app.inject({
        method: 'POST',
        url:    '/sidequests',
        body: {
          title:          'Caçada ao Dragão',
          description:    'Elimine o dragão',
          starts_at:      PAST,
          ends_at:        FUTURE,
          goal:           80,
          max_participants: 0,
          rules: { attribute: 'str', rewardFormula: 'proportional', rewardParameters: { xp_max: 200, gold_max: 50 } },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(ACT_ID);
      expect(body.status).toBe('WAITING');
      expect(body.activityType).toBe('SIDE_QUEST');
    });

    it('PLAYER tenta criar Side Quest — retorna 403', async () => {
      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    '/sidequests',
        body:   { title: 'X', description: 'Y', starts_at: PAST, ends_at: FUTURE, goal: 10 },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /sidequests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /sidequests', () => {
    it('Player lista Side Quests — retorna 200 com array', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ ...BASE_ACTIVITY, participant_count: 2 }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'GET', url: '/sidequests' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].id).toBe(ACT_ID);
      expect(body[0].participantCount).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /sidequests/:id
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /sidequests/:id', () => {
    it('retorna detalhes da atividade com participantes', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [BASE_PARTICIPANT], rowCount: 1 });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'GET', url: `/sidequests/${ACT_ID}` });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(ACT_ID);
      expect(Array.isArray(body.participants)).toBe(true);
      expect(body.participants[0].characterName).toBe('Thorin');
    });

    it('retorna 404 para atividade inexistente', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'GET', url: '/sidequests/nao-existe' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /sidequests/:id/join
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sidequests/:id/join', () => {
    it('body sem character_id — retorna 400', async () => {
      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('inscrição bem-sucedida — retorna contribution >= 0 e dice entre 1 e 20', async () => {
      // Sequência de client.query() calls dentro da transação:
      //   1. BEGIN
      //   2. SELECT ... FOR UPDATE (activity)
      //   3. SELECT ... (character + join)
      //   4. SELECT 1 ... (duplicidade)
      //   5. COUNT (participantes)
      //   6. INSERT activity_participants
      //   7. UPDATE activities.progress
      //   8. COMMIT
      mockClientQuery
        .mockResolvedValueOnce({})                                      // BEGIN
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })  // lock activity
        .mockResolvedValueOnce({ rows: [BASE_CHARACTER], rowCount: 1 }) // character
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })               // no duplicate
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 })     // count
        .mockResolvedValueOnce({ rows: [BASE_PARTICIPANT], rowCount: 1 }) // insert
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })               // update progress
        .mockResolvedValueOnce({});                                      // COMMIT

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   { character_id: CHAR_ID },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.characterId).toBe(CHAR_ID);
      expect(body.contribution).toBeGreaterThanOrEqual(0);
      expect(body.rolls.dice).toBeGreaterThanOrEqual(1);
      expect(body.rolls.dice).toBeLessThanOrEqual(20);
    });

    it('mesmo personagem inscrito duas vezes — retorna 409', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})                                      // BEGIN
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })  // lock activity
        .mockResolvedValueOnce({ rows: [BASE_CHARACTER], rowCount: 1 }) // character
        .mockResolvedValueOnce({ rows: [{ id: PART_ID }], rowCount: 1 }) // duplicate found
        .mockResolvedValueOnce({});                                     // ROLLBACK

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   { character_id: CHAR_ID },
      });

      expect(res.statusCode).toBe(409);
    });

    it('personagem morto — retorna 403', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})                                                              // BEGIN
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })                         // lock
        .mockResolvedValueOnce({ rows: [{ ...BASE_CHARACTER, dead: true }], rowCount: 1 })     // dead char
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })                                       // no duplicate
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 })                            // count
        .mockResolvedValueOnce({});                                                             // ROLLBACK

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   { character_id: CHAR_ID },
      });

      expect(res.statusCode).toBe(403);
    });

    it('personagem aposentado — retorna 403', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ ...BASE_CHARACTER, retired: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({});

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   { character_id: CHAR_ID },
      });

      expect(res.statusCode).toBe(403);
    });

    it('contribuição capada ao remaining — contribution <= remaining', async () => {
      // Atividade quase cheia: goal=20, progress=18 → remaining=2
      const almostFull = { ...BASE_ACTIVITY, goal: 20, progress: 18 };

      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [almostFull], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [BASE_CHARACTER], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ cnt: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ ...BASE_PARTICIPANT, contribution: 2 }],  // capped
          rowCount: 1,
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   { character_id: CHAR_ID },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // contribution não pode ultrapassar remaining (2)
      expect(body.contribution).toBeLessThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /sidequests/:id/cancel
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sidequests/:id/cancel', () => {
    it('GM cancela atividade WAITING — retorna status CANCELLED', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ ...BASE_ACTIVITY, status: 'CANCELLED' }], rowCount: 1 });

      const app = await buildTestApp({ mockUser: GM_USER });
      const res = await app.inject({ method: 'POST', url: `/sidequests/${ACT_ID}/cancel` });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('CANCELLED');
    });

    it('PLAYER tenta cancelar — retorna 403', async () => {
      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'POST', url: `/sidequests/${ACT_ID}/cancel` });

      expect(res.statusCode).toBe(403);
    });

    it('tentar cancelar atividade já CANCELLED — retorna 400', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ ...BASE_ACTIVITY, status: 'CANCELLED' }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: GM_USER });
      const res = await app.inject({ method: 'POST', url: `/sidequests/${ACT_ID}/cancel` });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /sidequests/:id/finish
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /sidequests/:id/finish', () => {
    it('GM encerra atividade — retorna activity com status FINISHED e report', async () => {
      const finishedActivity = { ...BASE_ACTIVITY, status: 'FINISHED', report: { summary: {} }, report_generated_at: NOW };

      mockClientQuery
        .mockResolvedValueOnce({})                                                                   // BEGIN
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })                               // lock
        .mockResolvedValueOnce({ rows: [{ ...BASE_PARTICIPANT, status: 'JOINED' }], rowCount: 1 })   // participants FOR UPDATE
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })                                             // update participant
        .mockResolvedValueOnce({ rows: [BASE_ACTIVITY], rowCount: 1 })                               // select for report
        .mockResolvedValueOnce({ rows: [finishedActivity], rowCount: 1 })                            // update activities
        .mockResolvedValueOnce({});                                                                   // COMMIT

      const app = await buildTestApp({ mockUser: GM_USER });
      const res = await app.inject({ method: 'POST', url: `/sidequests/${ACT_ID}/finish` });

      if (res.statusCode !== 200) {
        console.error('--- FINISH TEST FAILED ---');
        console.error(res.body);
      }

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.activity.status).toBe('FINISHED');
      expect(body.report).toBeDefined();
    });

    it('PLAYER tenta encerrar — retorna 403', async () => {
      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'POST', url: `/sidequests/${ACT_ID}/finish` });

      expect(res.statusCode).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /sidequests/:id/report
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /sidequests/:id/report', () => {
    it('relatório disponível após FINISHED — retorna 200', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{
          status:              'FINISHED',
          report:              { summary: {}, participants: [], statistics: {}, rewards: [] },
          report_generated_at: NOW,
        }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'GET', url: `/sidequests/${ACT_ID}/report` });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.report).toBeDefined();
      expect(body.reportGeneratedAt).toBeDefined();
    });

    it('relatório indisponível para atividade WAITING — retorna 400', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ status: 'WAITING', report: null, report_generated_at: null }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'GET', url: `/sidequests/${ACT_ID}/report` });

      expect(res.statusCode).toBe(400);
    });

    it('relatório de atividade inexistente — retorna 404', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({ method: 'GET', url: '/sidequests/nao-existe/report' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Inscrição em atividade cancelada
  // ─────────────────────────────────────────────────────────────────────────────

  describe('join em atividade cancelada', () => {
    it('retorna 403 ao tentar inscrever-se em Side Quest CANCELLED', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})                                                             // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...BASE_ACTIVITY, status: 'CANCELLED' }], rowCount: 1 }) // lock
        .mockResolvedValueOnce({ rows: [BASE_CHARACTER], rowCount: 1 })                        // character
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })                                      // no duplicate
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }], rowCount: 1 })                           // count
        .mockResolvedValueOnce({});                                                            // ROLLBACK

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url:    `/sidequests/${ACT_ID}/join`,
        body:   { character_id: CHAR_ID },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
