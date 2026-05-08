import cron from 'node-cron';
import { query } from '../db/index.js';

/**
 * Decay logic:
 * - After 5 days inactivity → lose 1 rose/day
 * - Crown = 10, bouquet = 5, min = 0
 * Runs daily at 03:00
 */
export function startCemeteryDecay() {
  cron.schedule('0 3 * * *', async () => {
    console.log('[cron] Running cemetery tribute cleanup...');
    try {
      await cleanExpiredTributes();
    } catch (err) {
      console.error('[cron] Cemetery cleanup error:', err);
    }
  });
  console.log('✓ Cemetery tribute cleanup cron scheduled (daily 03:00)');
}
