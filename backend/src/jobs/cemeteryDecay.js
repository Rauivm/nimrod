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
    console.log('[cron] Running cemetery decay...');
    try {
      const res = await query(
        `UPDATE characters
         SET tribute_count = GREATEST(tribute_count - 1, 0)
         WHERE last_tribute_at IS NOT NULL
           AND last_tribute_at < NOW() - INTERVAL '5 days'
           AND tribute_count > 0
         RETURNING id, name, tribute_count`,
        []
      );
      console.log(`[cron] Decayed ${res.rowCount} characters`);
    } catch (err) {
      console.error('[cron] Cemetery decay error:', err);
    }
  });
  console.log('✓ Cemetery decay cron scheduled (daily 03:00)');
}
