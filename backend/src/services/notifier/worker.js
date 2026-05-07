import { sendDiscordMessage } from './discord.js';
import {
  registerNotifierWorker,
  retryNotification,
  scheduleNotifierDrain,
  shiftNotification,
} from './queue.js';

const MAX_ATTEMPTS = Number(process.env.NOTIFIER_MAX_ATTEMPTS || 3);
const BASE_RETRY_MS = Number(process.env.NOTIFIER_RETRY_MS || 1500);

async function processNotifierQueue() {
  let job;
  while ((job = shiftNotification())) {
    try {
      if (job.type === 'discord') {
        await sendDiscordMessage(job.payload);
      }
    } catch (err) {
      job.attempts = Number(job.attempts || 0) + 1;
      if (job.attempts < MAX_ATTEMPTS) {
        retryNotification(job, BASE_RETRY_MS * job.attempts);
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[notifier] dropped notification:', err.message);
      }
    }
  }
}

registerNotifierWorker(processNotifierQueue);

export function startNotifierWorker() {
  scheduleNotifierDrain();
}
