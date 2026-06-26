/**
 * nimrod-bridge.js
 *
 * Foundry VTT module - Nimrod Identity Bridge.
 *
 * Reads ?t=<jwt>, verifies it with Nimrod, activates the linked Nimrod session,
 * records presence, and opens the mapped actor sheet when available.
 */

const MODULE_ID = 'nimrod-bridge';

function contextValue(ctx, longKey, shortKey) {
  return ctx?.[longKey] ?? ctx?.[shortKey] ?? null;
}

async function postPresence(path, token, ctx) {
  const activeSessionId = ctx?.activeSessionId || ctx?.sessionId || null;
  if (!token || !activeSessionId) return;

  const actorName = contextValue(ctx, 'actor', 'a') || ctx.actorName || null;
  try {
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        actorName,
        characterId: ctx.characterId ?? null,
      }),
      keepalive: path.endsWith('/leave'),
    });
  } catch (err) {
    console.warn(`[${MODULE_ID}] Session presence sync failed (${path}):`, err);
  }
}

Hooks.once('ready', async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');

  if (!token) return;

  try {
    params.delete('t');
    const clean = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, document.title, clean);
  } catch {
    // Token cleanup is best-effort.
  }

  let ctx;
  try {
    const res = await fetch('/nimrod/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
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

  const email = contextValue(ctx, 'email', 'e');
  const role = contextValue(ctx, 'role', 'r');
  const world = contextValue(ctx, 'world', 'w');
  const actorName = contextValue(ctx, 'actor', 'a') || ctx.actorName || null;
  const activeSessionId = ctx.activeSessionId || ctx.sessionId || null;

  console.info(`[${MODULE_ID}] Verified identity: ${email} (${role}) -> world: ${world}`);

  if (activeSessionId && game.settings?.settings?.has('nimrod-session.activeSessionId')) {
    try {
      await game.settings.set('nimrod-session', 'activeSessionId', activeSessionId);
      console.info(`[${MODULE_ID}] Active Nimrod session set: ${activeSessionId}`);
    } catch (err) {
      console.warn(`[${MODULE_ID}] Could not set nimrod-session activeSessionId:`, err);
    }
  }

  if (activeSessionId) {
    await postPresence('/nimrod/session/enter', token, ctx);
    window.addEventListener('beforeunload', () => {
      postPresence('/nimrod/session/leave', token, ctx);
    }, { once: true });
  }

  if (world && game.world?.id && world !== game.world.id) {
    console.warn(
      `[${MODULE_ID}] Token world "${world}" differs from current world "${game.world.id}". Skipping actor selection.`,
    );
    return;
  }

  if (actorName) {
    const actor = game.actors?.find(a => a.name === actorName);

    if (actor) {
      actor.sheet.render(true);
      console.info(`[${MODULE_ID}] Opened actor sheet: ${actorName}`);
    } else {
      console.warn(`[${MODULE_ID}] Actor "${actorName}" not found in this world.`);
    }
  }
});
