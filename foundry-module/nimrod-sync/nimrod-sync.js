// nimrod-sync.js
import { SyncCollector } from './collector.js';

const MODULE_ID = 'nimrod-sync';

Hooks.once('ready', () => {
  console.log('[nimrod-sync] Ready');

  // Push full roster on load so Nimrod is always seeded
  for (const actor of game.actors) {
    if (actor.type === 'character' && actor.hasPlayerOwner) {
      SyncCollector.collect(actor);
    }
  }

  const handle = (actor) => {
    if (actor.type !== 'character' || !actor.hasPlayerOwner) return;
    SyncCollector.collect(actor);
  };

  Hooks.on('createActor', handle);
  Hooks.on('updateActor', handle);
  Hooks.on('deleteActor', handle);

  console.log('[nimrod-sync] Collector active');
});