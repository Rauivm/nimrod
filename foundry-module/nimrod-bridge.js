/**
 * nimrod-bridge.js
 *
 * Foundry VTT module — Nimrod Identity Bridge
 *
 * On world ready:
 *  1. Reads ?t=<jwt> from the URL
 *  2. Verifies the token with the Nimrod backend (/nimrod/verify)
 *  3. Opens the matched actor's sheet if found
 *  4. Cleans the token from the browser URL bar
 *
 * The /nimrod/verify endpoint lives on the SAME origin as Foundry
 * because nginx proxies /nimrod/* → Nimrod backend.
 * No CORS issues, no hardcoded backend URL needed.
 */

const MODULE_ID = 'nimrod-bridge';

Hooks.once('ready', async () => {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('t');

  if (!token) return;

  // Remove token from URL bar immediately (no reload)
  try {
    params.delete('t');
    const clean = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, document.title, clean);
  } catch {
    // replaceState not critical — continue
  }

  let ctx;
  try {
    const res = await fetch('/nimrod/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });

    if (!res.ok) {
      console.warn(`[${MODULE_ID}] Token verification failed: ${res.status}`);
      return;
    }

    ctx = await res.json();
  } catch (err) {
    console.error(`[${MODULE_ID}] Network error during token verification:`, err);
    return;
  }

  console.info(`[${MODULE_ID}] Verified identity: ${ctx.email} (${ctx.role}) → world: ${ctx.world}`);

  // Switch to the correct world if needed
  if (ctx.world && game.world?.id && ctx.world !== game.world.id) {
    console.warn(
      `[${MODULE_ID}] Token world "${ctx.world}" differs from current world "${game.world.id}". Skipping actor selection.`,
    );
    return;
  }

  // Open actor sheet
  if (ctx.actor) {
    const actor = game.actors?.find(a => a.name === ctx.actor);

    if (actor) {
      actor.sheet.render(true);
      console.info(`[${MODULE_ID}] Opened actor sheet: ${ctx.actor}`);
    } else {
      console.warn(`[${MODULE_ID}] Actor "${ctx.actor}" not found in this world.`);
    }
  }
});
