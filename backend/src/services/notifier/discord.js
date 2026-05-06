/**
 * discord.js
 *
 * Low-level Discord webhook transport.
 * Fails silently: a missing or broken webhook never crashes the app.
 *
 * Usage:
 *   import { sendDiscordMessage } from './discord.js';
 *   await sendDiscordMessage({ content: 'Hello', embeds: [...] });
 */

/**
 * @param {{ content?: string, embeds?: object[] }} payload
 * @returns {Promise<void>}
 */
export async function sendDiscordMessage(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) return; // webhook not configured — silent no-op

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Discord returns 204 on success; log unexpected failures at debug level
    if (!res.ok && process.env.NODE_ENV !== 'production') {
      console.warn(`[discord] webhook returned ${res.status}`);
    }
  } catch (err) {
    // Network failure — never propagate to the caller
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[discord] webhook error:', err.message);
    }
  }
}
