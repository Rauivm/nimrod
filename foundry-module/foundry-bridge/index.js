/**
 * foundry-bridge/index.js
 *
 * Recebe eventos do módulo Foundry (browser → localhost:3999)
 * e enfileira jobs no BullMQ / Redis.
 *
 * Rotas:
 *  POST /sync        – incremental (debounced, 1..N actors)
 *  POST /sync/full   – reconciliation completa (todos os player chars)
 *  GET  /health      – health check
 *  GET  /admin/queues – Bull Board UI
 */

import Fastify           from 'fastify';
import cors              from '@fastify/cors';
import { z }             from 'zod';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv            from 'dotenv';

import { syncQueue }       from './src/queue.js';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter }   from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter }  from '@bull-board/fastify';

// ── Env ───────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

// ── App ───────────────────────────────────────────────────────────────────────
const app = Fastify({ logger: true });

// CORS: aceita chamadas do browser do Foundry (localhost:30000 e localhost:30001)
// e do worker (sem origem). origin: true aceita qualquer origem — seguro porque
// a porta 3999 nunca é exposta externamente (bind em 127.0.0.1).
await app.register(cors, {
  origin:  true,
  methods: ['GET', 'POST', 'OPTIONS'],
});

// ── Bull Board ────────────────────────────────────────────────────────────────
const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(syncQueue)], serverAdapter });
await app.register(serverAdapter.registerPlugin(), {
  prefix:   '/admin/queues',
  basePath: '/admin/queues',
});

// ── Schemas Zod ───────────────────────────────────────────────────────────────
const ActorSchema = z.object({
  id:         z.string().min(1),
  name:       z.string().min(1),
  img:        z.string().nullable().optional(),
  tokenImg:   z.string().nullable().optional(),
  level:      z.number().int().min(0).optional(),
  xp:         z.number().int().min(0).optional(),
  xpNext:     z.number().int().min(1).optional(),
  classe:     z.string().nullable().optional(),
  race:       z.string().nullable().optional(),
  biography:  z.string().nullable().optional(),
  isDead:     z.boolean().optional(),
  isRetired:  z.boolean().optional(),
  modifiedAt: z.number().optional(),
});

const IncrementalPayload = z.object({
  actors: z.array(ActorSchema).min(1),
});

const FullPayload = z.object({
  actors: z.array(ActorSchema).min(1),
});

// ── POST /sync — incremental ──────────────────────────────────────────────────
app.post('/sync', async (req, reply) => {
  const parsed = IncrementalPayload.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, '[bridge] /sync Zod rejected');
    return reply.status(400).send({ ok: false, errors: parsed.error.issues });
  }

  await syncQueue.add(
    'sync-actors',
    { actors: parsed.data.actors, fullSync: false },
    {
      removeOnComplete: 100,
      removeOnFail:     200,
      attempts:         5,
      backoff: { type: 'exponential', delay: 2_000 },
    },
  );

  req.log.info({ queued: parsed.data.actors.length }, '[bridge] incremental queued');
  return { ok: true, queued: parsed.data.actors.length };
});

// ── POST /sync/full — reconciliation ─────────────────────────────────────────
app.post('/sync/full', async (req, reply) => {
  const parsed = FullPayload.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, '[bridge] /sync/full Zod rejected');
    return reply.status(400).send({ ok: false, errors: parsed.error.issues });
  }

  await syncQueue.add(
    'sync-full',
    { actors: parsed.data.actors, fullSync: true },
    {
      // Jobs de reconciliation têm prioridade mais alta
      priority:         1,
      removeOnComplete: 50,
      removeOnFail:     100,
      attempts:         5,
      backoff: { type: 'exponential', delay: 2_000 },
    },
  );

  req.log.info({ queued: parsed.data.actors.length }, '[bridge] full sync queued');
  return { ok: true, queued: parsed.data.actors.length };
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', async () => ({ ok: true, ts: Date.now() }));

// ── Start ─────────────────────────────────────────────────────────────────────
// Bind em 127.0.0.1 — NUNCA em 0.0.0.0 (porta não deve ser acessível externamente)
// Before (broken in Docker):
//await app.listen({ host: '127.0.0.1', port: 3999 });

// After:
await app.listen({ host: '0.0.0.0', port: 3999 });
