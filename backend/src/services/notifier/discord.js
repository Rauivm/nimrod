/**
 * Low-level Discord webhook transport.
 * Missing or broken webhooks never crash or fail app requests.
 */

/**
 * @param {{ content?: string, embeds?: object[] }} payload
 * @returns {Promise<void>}
 */
export async function sendDiscordMessage(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) return;

  const timeoutMs = Number(process.env.DISCORD_WEBHOOK_TIMEOUT_MS || 3500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok && process.env.NODE_ENV !== 'production') {
      console.warn(`[discord] webhook returned ${res.status}`);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[discord] webhook error:', err.message);
    }
  } finally {
    clearTimeout(timer);
  }
}
