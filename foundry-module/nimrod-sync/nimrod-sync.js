// nimrod-sync.js
import { SyncCollector } from './collector.js';

async function syncAllActors() {
  const actors = game.actors?.filter(
    a => a.type === 'character' && a.hasPlayerOwner
  ) ?? [];

  if (!actors.length) {
    console.log('[nimrod-sync] No player-owned characters found.');
    return;
  }

  for (const actor of actors) {
    SyncCollector.collect(actor);
  }

  // Cancela o debounce pendente e faz flush imediato
  SyncCollector.cancelPendingFlush();
  await SyncCollector.flush();

  console.log(`[nimrod-sync] Full sync triggered for ${actors.length} actors.`);
}

Hooks.once('ready', async () => {
  console.log('[nimrod-sync] Ready hook fired');

  // ── Sync inicial ao carregar o mundo ──────────────────────────────────────
  await syncAllActors();

  // ── Hooks incrementais ────────────────────────────────────────────────────
  // updateActor recebe (actor, changes, options, userId) no v13/v14
  Hooks.on('createActor', (actor) => {
    if (actor.type !== 'character' || !actor.hasPlayerOwner) return;
    SyncCollector.collect(actor);
  });

  Hooks.on('updateActor', (actor, _changes, _options, _userId) => {
    if (actor.type !== 'character' || !actor.hasPlayerOwner) return;
    SyncCollector.collect(actor);
  });

  // ── Botão na barra de cena (v13/v14: controls é um OBJETO, não array) ─────
  //
  // BREAKING CHANGE v13: controls.push() não existe mais.
  // A forma correta é: controls['nimrod-sync'] = { ... }
  // tools também é um objeto keyed por nome, não array.
  // O campo "layer" foi removido.
  //
  Hooks.on('getSceneControlButtons', (controls) => {
    controls['nimrod-sync'] = {
      name:  'nimrod-sync',
      title: 'Nimrod Sync',
      icon:  'fa-solid fa-dragon',
      order: 99,
      tools: {
        'sync-all': {
          name:    'sync-all',
          title:   'Sync All Actors',
          icon:    'fa-solid fa-rotate',
          button:  true,
          onClick: async () => {
            ui.notifications.info('[Nimrod] Starting full sync...');
            await syncAllActors();
            ui.notifications.info('[Nimrod] Full sync completed.');
          },
        },
      },
    };
  });

  // ── Reconciliação periódica a cada 10 minutos ─────────────────────────────
  setInterval(() => syncAllActors(), 1000 * 60 * 10);

  // ── Expõe API global para debugging no console ────────────────────────────
  game.nimrodSync = { syncAllActors };

  console.log('[nimrod-sync] Collector active — hooks registered');
});
