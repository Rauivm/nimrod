const MODULE_ID = 'nimrod-sync';

/* ── Settings ───────────────────────────────────────────────────────────── */
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'backendUrl', {
    name: 'Backend URL',
    hint: 'Nimrod backend base URL',
    scope: 'world',
    config: true,
    type: String,
    default: 'http://localhost:3001',
  });

  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'API Key',
    hint: 'Must match FOUNDRY_API_KEY on backend',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'enabled', {
    name: 'Enable sync',
    hint: 'Push actors to Nimrod backend',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
});

/* ── Ready ──────────────────────────────────────────────────────────────── */
Hooks.once('ready', () => {
  console.log('[nimrod-sync] READY');

  const enabled =
    game.settings.get(MODULE_ID, 'enabled');

  if (!enabled) {
    console.warn('[nimrod-sync] Disabled');
    return;
  }

  const apiKey =
    game.settings.get(MODULE_ID, 'apiKey')?.trim();

  const backendUrl =
    game.settings
      .get(MODULE_ID, 'backendUrl')
      ?.replace(/\/$/, '');

  if (!apiKey || !backendUrl) {
    console.warn(
      '[nimrod-sync] Missing backend URL or API key',
    );
    return;
  }

  async function pushActors() {
    try {
      const actors = buildActorPayload();

      const response = await fetch(
        `${backendUrl}/foundry/push-actors`,
        {
          method: 'POST',
          //mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json',
            'X-Nimrod-Key': apiKey,
          },
          body: JSON.stringify({
            actors,
          }),
        },
      );

      if (!response.ok) {
        console.error(
          '[nimrod-sync] Push failed:',
          response.status,
        );

        return;
      }

      console.log(
        `[nimrod-sync] Pushed ${actors.length} actors`,
      );
    } catch (err) {
      console.error(
        '[nimrod-sync] Sync error:',
        err,
      );
    }
  }

  pushActors();

  setInterval(pushActors, 30000);

  Hooks.on('createActor', pushActors);
  Hooks.on('updateActor', pushActors);
  Hooks.on('deleteActor', pushActors);

  console.log('[nimrod-sync] Push sync active');
});

/* ── Actor payload builder ──────────────────────────────────────────────── */
function buildActorPayload() {
  const pcs =
    game.actors.filter(a => a.type === 'character');

  return pcs.map(actor => {
    const sys = actor.system ?? {};

    let level = 1;
    let xp = 0;
    let xpNext = 300;

    if (sys.details?.level !== undefined) {
      level  = sys.details.level ?? 1;
      xp     = sys.details.xp?.value ?? 0;
      xpNext = sys.details.xp?.max ?? 300;
    }

    const classe =
      sys.details?.class?.value ??
      sys.details?.class ??
      null;

    const race =
      sys.details?.race?.value ??
      sys.details?.race ??
      null;

    const tokenImg =
      actor.prototypeToken?.texture?.src ??
      actor.img ??
      null;

    const portraitImg =
      actor.img ?? null;

    const rawBio =
      sys.details?.biography?.value ?? '';

    const biography = rawBio
      ? rawBio
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2000)
      : null;

    return {
      id: actor.id,
      name: actor.name,
      img: portraitImg,
      tokenImg,
      level,
      xp,
      xpNext,
      classe,
      race,
      biography,
      retired:
        actor.getFlag(MODULE_ID, 'retired') ?? false,
      dead:
        actor.getFlag(MODULE_ID, 'dead') ?? false,
      retireReason:
        actor.getFlag(MODULE_ID, 'retireReason') ?? null,
    };
  });
}