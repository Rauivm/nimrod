// foundry-bridge/src/worker.js
import { Worker, QueueEvents } from 'bullmq';
import { createRequire }       from 'module';
import { fileURLToPath }       from 'url';
import { dirname, join }       from 'path';
import dotenv                  from 'dotenv';
import { connection }          from './queue.js';

// __dirname não existe em ESM — precisa ser derivado assim
const __dirname = dirname(fileURLToPath(import.meta.url));

// De src/worker.js → ../../../.env = C:\Foundry\nimrod\.env
// src/worker.js — sobe src/ → foundry-bridge/ → nimrod/ → .env
dotenv.config({ path: join(__dirname, './../../../.env') });

const NIMROD_URL = process.env.NIMROD_URL;
const API_KEY    = process.env.FOUNDRY_API_KEY;

if (!NIMROD_URL) throw new Error('NIMROD_URL não definido no .env');
if (!API_KEY)    throw new Error('FOUNDRY_API_KEY não definido no .env');

console.log('[worker] NIMROD_URL:', NIMROD_URL);

const events = new QueueEvents('foundry-sync', { connection });

events.on('failed',    ({ jobId, failedReason }) =>
  console.error(`[bullmq] Job ${jobId} failed: ${failedReason}`));
events.on('stalled',   ({ jobId }) =>
  console.warn(`[bullmq] Job ${jobId} stalled`));
events.on('completed', ({ jobId }) =>
  console.log(`[bullmq] Job ${jobId} completed`));

new Worker(
  'foundry-sync',
  async (job) => {
    const { actors } = job.data;

    const response = await fetch(NIMROD_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nimrod-Key': API_KEY,
      },
      body: JSON.stringify({ actors }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Nimrod responded ${response.status}: ${body.slice(0, 200)}`);
    }

    console.log(`[worker] Synced ${actors.length} actors (job ${job.id})`);
  },
  {
    connection,
    concurrency: 2,
    limiter: { max: 10, duration: 1_000 },
  },
);

console.log('[foundry-bridge worker] Started');