// foundry-bridge/src/worker.js
import { Worker } from 'bullmq';
import { connection } from './queue.js';
import { QueueEvents } from 'bullmq';

import dotenv from 'dotenv';

dotenv.config({
  path:
    '../../.env',
});

const NIMROD_URL = process.env.NIMROD_URL || 'https://nimrod.raui.uk/foundry/push-actors';
const API_KEY    = process.env.FOUNDRY_API_KEY;

if (!API_KEY) throw new Error('FOUNDRY_API_KEY env var is required');

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
      // BullMQ will retry with exponential backoff on thrown errors
    }

    console.log(`[worker] Synced ${actors.length} actors (job ${job.id})`);
  },

  {
    connection,
    concurrency:    2,   // at most 2 parallel pushes to Nimrod
    limiter: {
      max:          10,  // max 10 jobs per
      duration:  1_000,  // per second — rate limit to protect Nimrod
    },
  },
);

console.log('[foundry-bridge worker] Started');