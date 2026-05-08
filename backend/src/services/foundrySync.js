/**
 * services/foundrySync.js
 *
 * Foundry V13+ sync using LevelDB actor storage.
 *
 * Compatible with:
 *   Data/worlds/<world>/data/actors
 *
 * Requirements:
 *   npm install level
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Level } from 'level';

import { query } from '../db/index.js';

const SYSTEM = process.env.FOUNDRY_SYSTEM || 'dnd5e';

/**
 * Resolve actors LevelDB directory.
 */
function getActorsPath() {
  const dataPath = process.env.FOUNDRY_DATA_PATH;
  const world = process.env.FOUNDRY_WORLD;

  if (!dataPath || !world) {
    return null;
  }

  const p = join(
    dataPath,
    'worlds',
    world,
    'data',
    'actors',
  );

  return existsSync(p) ? p : null;
}

/**
 * Read all actors from Foundry LevelDB.
 */
async function readActorsDb(actorsPath) {
  const db = new Level(actorsPath, {
    valueEncoding: 'json',
    readOnly: true,
  });

  const actors = [];

  await db.open();

  try {
    const iterator = db.iterator();

    while (true) {
      const result = await iterator.next();

      if (!result) {
        break;
      }

      const [key, value] = result;

      if (
        value &&
        typeof value === 'object'
      ) {
        actors.push(value);
      }
    }

    await iterator.close();

    return actors;
  } finally {
    await db.close();
  }
}

/**
 * Extract level/xp safely.
 */
function extractLevelXp(actor) {
  const sys = actor.system ?? {};

  // D&D5e
  if (sys.details?.level !== undefined) {
    return {
      level: sys.details.level ?? 1,
      xp: sys.details?.xp?.value ?? 0,
      xpNext: sys.details?.xp?.max ?? 300,
    };
  }

  // PF2E
  if (sys.details?.level?.value !== undefined) {
    return {
      level: sys.details.level.value ?? 1,
      xp: 0,
      xpNext: 1000,
    };
  }

  return {
    level: 1,
    xp: 0,
    xpNext: 300,
  };
}

/**
 * Sync all player characters from Foundry.
 */
export async function syncFoundryActors() {
  const actorsPath = getActorsPath();

  if (!actorsPath) {
    return {
      synced: 0,
      skipped: 0,
      error: 'Foundry actors path not found',
    };
  }

  console.log('[foundrySync] Actors path:', actorsPath);

  let actors = [];

  try {
    actors = await readActorsDb(actorsPath);
  } catch (err) {
    console.error('[foundrySync] Failed reading LevelDB:', err);

    return {
      synced: 0,
      skipped: 0,
      error: err.message,
    };
  }

  console.log('[foundrySync] Total actors loaded:', actors.length);

  const pcs = actors.filter(actor => {
    return (
      actor &&
      actor.name &&
      (
        actor.type === 'character' ||
        actor.type === 'Character' ||
        actor.type === 'PC'
      )
    );
  });

  console.log(
    '[foundrySync] Player characters:',
    pcs.map(a => a.name),
  );

  let synced = 0;
  let skipped = 0;

  for (const actor of pcs) {
    try {
      const { level, xp, xpNext } = extractLevelXp(actor);

      const tokenImg =
        actor.prototypeToken?.texture?.src ??
        actor.token?.img ??
        null;

      const portraitImg =
        actor.img ?? null;

      const biography =
        actor.system?.details?.biography?.value ??
        null;

      await query(
        `
        INSERT INTO player_characters (
          foundry_actor_id,
          name,
          level,
          xp,
          xp_next,
          token_img,
          portrait_img,
          biography,
          system,
          last_synced_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, NOW()
        )
        ON CONFLICT (foundry_actor_id)
        DO UPDATE SET
          name            = EXCLUDED.name,
          level           = EXCLUDED.level,
          xp              = EXCLUDED.xp,
          xp_next         = EXCLUDED.xp_next,
          token_img       = EXCLUDED.token_img,
          portrait_img    = EXCLUDED.portrait_img,
          biography       = EXCLUDED.biography,
          last_synced_at  = NOW(),
          updated_at      = NOW()
        `,
        [
          actor._id,
          actor.name,
          level,
          xp,
          xpNext,
          tokenImg,
          portraitImg,
          biography,
          SYSTEM,
        ],
      );

      console.log(
        `[foundrySync] Synced actor: ${actor.name}`
      );

      synced++;
    } catch (err) {
      console.error(
        `[foundrySync] Failed actor ${actor.name}:`,
        err.message,
      );

      skipped++;
    }
  }

  console.log(
    `[foundrySync] Sync complete: ${synced} synced, ${skipped} skipped`
  );

  return {
    synced,
    skipped,
    error: null,
  };
}

/**
 * Periodic sync job.
 */
export function startFoundrySync() {
  const configured =
    !!process.env.FOUNDRY_DATA_PATH &&
    !!process.env.FOUNDRY_WORLD;

  if (!configured) {
    console.log(
      '[foundrySync] Not configured'
    );

    return;
  }

  syncFoundryActors().catch(err => {
    console.error(
      '[foundrySync] Initial sync failed:',
      err.message,
    );
  });

  setInterval(() => {
    syncFoundryActors().catch(err => {
      console.error(
        '[foundrySync] Periodic sync failed:',
        err.message,
      );
    });
  }, 5 * 60 * 1000);

  console.log(
    '[foundrySync] Auto-sync started'
  );
}