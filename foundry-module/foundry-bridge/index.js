// foundry-bridge/src/index.js
import Fastify       from 'fastify';
import cors          from '@fastify/cors';
import { z }         from 'zod';
// index.js — está na raiz, queue está em src/
import { syncQueue } from './src/queue.js'; // ← correto

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter }  from '@bull-board/fastify';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv            from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../../.env') });

const app = Fastify({ logger: true });
await app.register(cors, { origin: false });

const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(syncQueue)], serverAdapter });
await app.register(serverAdapter.registerPlugin(), {
  prefix:   '/admin/queues',
  basePath: '/admin/queues',
});

const ActorSchema = z.object({
  id:         z.string(),
  name:       z.string(),
  img:        z.string().nullable().optional(),
  tokenImg:   z.string().nullable().optional(),
  level:      z.number().int().optional(),
  xp:         z.number().int().optional(),
  xpNext:     z.number().int().optional(),
  classe:     z.string().nullable().optional(),
  race:       z.string().nullable().optional(),
  biography:  z.string().nullable().optional(),
  isDead:     z.boolean().optional(),
  isRetired:  z.boolean().optional(),
  modifiedAt: z.number().optional(),
});

const PayloadSchema = z.object({
  actors: z.array(ActorSchema).min(1),
});

app.post('/sync', async (req, reply) => {
  const parsed = PayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, 'Zod rejected payload');
    return reply.status(400).send({ ok: false, errors: parsed.error.issues });
  }
  await syncQueue.add('sync-actors', { actors: parsed.data.actors }, {
    removeOnComplete: 100,
    removeOnFail:     200,
    attempts:         5,
    backoff: { type: 'exponential', delay: 2_000 },
  });
  req.log.info({ queued: parsed.data.actors.length });
  return { ok: true };
});

app.get('/health', async () => ({ ok: true }));

await app.listen({ host: '127.0.0.1', port: 3999 });
//await app.listen({ host: '0.0.0.0', port: 3999 });
//                  ^^^^^^^^^^^^ localhost only — never 0.0.0.0