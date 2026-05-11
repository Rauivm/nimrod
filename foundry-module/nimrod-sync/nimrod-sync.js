const MODULE_ID = 'nimrod-sync';

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'API Key',
    hint: 'Must match backend FOUNDRY_API_KEY',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
});

Hooks.once('ready', () => {
  console.log('[nimrod-sync] READY');

  const apiKey =
    game.settings.get(MODULE_ID, 'apiKey')?.trim();

  if (!apiKey) {
    console.warn('[nimrod-sync] Missing API key');
    return;
  }

  const router =
    globalThis?.game?.server?._app;

  if (!router) {
    console.error(
      '[nimrod-sync] Express app unavailable',
    );
    return;
  }

  if (globalThis.nimrodRouteRegistered) {
    return;
  }

  globalThis.nimrodRouteRegistered = true;

  router.get(
    '/api/nimrod/actors',
    (req, res) => {
      const key =
        req.headers['x-nimrod-key'];

      if (key !== apiKey) {
        return res
          .status(401)
          .json({
            error: 'Unauthorized',
          });
      }

      return res.json(
        buildActorPayload(),
      );
    },
  );

  console.log(
    '[nimrod-sync] API route registered',
  );
});

function buildActorPayload() {
  const pcs =
    game.actors.filter(
      a => a.type === 'character',
    );

  return pcs.map(actor => {
    const sys = actor.system ?? {};

    let level = 1;
    let xp = 0;
    let xpNext = 300;

    if (sys.details?.level !== undefined) {
      level = sys.details.level ?? 1;
      xp = sys.details.xp?.value ?? 0;
      xpNext = sys.details.xp?.max ?? 300;
    }

    return {
      id: actor.id,
      name: actor.name,
      img: actor.img ?? null,
      tokenImg:
        actor.prototypeToken?.texture?.src ??
        actor.img ??
        null,
      level,
      xp,
      xpNext,
      classe:
        sys.details?.class?.value ??
        sys.details?.class ??
        null,
      race:
        sys.details?.race?.value ??
        sys.details?.race ??
        null,
      biography:
        sys.details?.biography?.value ??
        null,
      retired:
        actor.getFlag(
          MODULE_ID,
          'retired',
        ) ?? false,
      dead:
        actor.getFlag(
          MODULE_ID,
          'dead',
        ) ?? false,
      retireReason:
        actor.getFlag(
          MODULE_ID,
          'retireReason',
        ) ?? null,
    };
  });
}