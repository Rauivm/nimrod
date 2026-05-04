/**
 * nimrod-launcher — Foundry VTT Module
 *
 * Reads Nimrod launch parameters injected into the URL by the Nimrod backend
 * and surfaces contextual information (character, role) when Foundry is ready.
 *
 * Constraints enforced:
 *  - No Foundry database writes
 *  - No authentication overrides
 *  - No passwords or tokens handled
 *  - Fully safe when params are absent (graceful no-op)
 *  - Pure client-side behaviour
 */

const MODULE_ID = 'nimrod-launcher';

/* ── Parameter parsing ─────────────────────────────────────────────────────── */

/**
 * Parse the Nimrod launch parameters from the current URL.
 *
 * Expected shape: ?world=<slug>&role=GM|PLAYER&actor=<name>
 *
 * @returns {{ world: string|null, role: string|null, actorName: string|null }}
 */
function parseLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    world:     params.get('world')  || null,
    role:      params.get('role')   || null,
    actorName: params.get('actor')  || null,
  };
}

/* ── World validation ──────────────────────────────────────────────────────── */

/**
 * Compare the expected world slug from the URL to the active Foundry world.
 * Logs a warning if they differ — does not block anything.
 *
 * @param {string|null} expectedWorld
 */
function warnIfWorldMismatch(expectedWorld) {
  if (!expectedWorld) return;

  // game.world.id is the world's machine-readable slug in Foundry v11+
  const activeWorld = game.world?.id ?? '';
  if (activeWorld && activeWorld !== expectedWorld) {
    console.warn(
      `[${MODULE_ID}] World mismatch — expected "${expectedWorld}", active "${activeWorld}"`,
    );
    ui.notifications.warn(
      game.i18n.format('NIMROD.WorldMismatch', {
        expected: expectedWorld,
        active:   activeWorld,
      }),
    );
  }
}

/* ── Character suggestion ──────────────────────────────────────────────────── */

/**
 * Find the actor by name and optionally open their sheet.
 *
 * @param {string} actorName
 * @param {boolean} autoOpenSheet – open the character sheet automatically
 */
function suggestCharacter(actorName, autoOpenSheet = false) {
  const actor = game.actors.find(
    (a) => a.name.toLowerCase() === actorName.toLowerCase(),
  );

  if (!actor) {
    console.warn(`[${MODULE_ID}] Actor not found: "${actorName}"`);
    ui.notifications.warn(
      game.i18n.format('NIMROD.CharacterNotFound', { name: actorName }),
    );
    return;
  }

  ui.notifications.info(
    game.i18n.format('NIMROD.CharacterSuggested', { name: actor.name }),
  );

  if (autoOpenSheet) {
    actor.sheet.render(true);
  }
}

/* ── Role banner ───────────────────────────────────────────────────────────── */

/**
 * Show a greeting for the GM role.
 *
 * @param {string} role
 */
function handleRole(role) {
  if (role?.toUpperCase() === 'GM') {
    ui.notifications.info(game.i18n.localize('NIMROD.GMAccess'));
  }
}

/* ── Settings ─────────────────────────────────────────────────────────────── */

function registerSettings() {
  game.settings.register(MODULE_ID, 'autoOpenSheet', {
    name:    'Auto-open character sheet',
    hint:    'Automatically render the character sheet when Nimrod suggests an actor.',
    scope:   'client',
    config:  true,
    type:    Boolean,
    default: false,
  });
}

/* ── Main hook ─────────────────────────────────────────────────────────────── */

Hooks.once('init', () => {
  registerSettings();
  console.log(`[${MODULE_ID}] Initialised.`);
});

Hooks.once('ready', () => {
  const { world, role, actorName } = parseLaunchParams();

  // Nothing to do if Nimrod didn't launch this session
  if (!world && !role && !actorName) return;

  console.log(`[${MODULE_ID}] Launch params →`, { world, role, actorName });

  warnIfWorldMismatch(world);
  handleRole(role);

  if (actorName) {
    const autoOpen = game.settings.get(MODULE_ID, 'autoOpenSheet');
    suggestCharacter(actorName, autoOpen);
  }
});
