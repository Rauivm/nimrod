// foundry-bridge/src/queue.js
import { Queue   } from 'bullmq';
import IORedis     from 'ioredis';

export const connection = new IORedis({
  host:                 process.env.REDIS_HOST || 'localhost',
  port:                 parseInt(process.env.REDIS_PORT) || 6379,
  password:             process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // required by BullMQ
});

export const syncQueue = new Queue('foundry-sync', { connection });