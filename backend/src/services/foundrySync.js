/**
 * services/foundrySync.js
 *
 * Reads Foundry VTT's actors.db (NeDB JSONL format) from the filesystem
 * and upserts into player_characters.
 *
 * Contract:
 *  - NEVER writes to Foundry's database
 *  - NEVER modifies Foundry authentication
 *  - Gracefully no-ops if the file is missing or Foundry is offline
 *  - Idempotent: safe to run multiple times
 *
 * Config (.env):
 *  FOUNDRY_DATA_PATH=/path/to/foundry/Data   (default: ./foundry-data)
 *  FOUNDRY_WORLD=my-world-name               (required for sync)
 *  FOUNDRY_SYSTEM=dnd5e                      (default: dnd5e)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { query } from '../db/index.js';

const SYSTEM = process.env.FOUNDRY_SYSTEM || 'dnd5e';

/**
 * Resolve the actors.db path from env.
 * Returns null if not configured or file doesn't exist.
 */
function getActorsDbPath() {
  const dataPath = process.env.FOUNDRY_DATA_PATH;
  const world    = process.env.FOUNDRY_WORLD;
  if (!dataPath || !world) return null;

  const p = join(dataPath, 'worlds', world, 'data', 'actors.db');
  return existsSync(p) ? p : null;
}

/**
 * Parse NeDB JSONL — each line is a JSON object or a deletion tombstone.
 * Returns the latest live version of each actor (tombstones remove entries).
 */
function parseActorsDb(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  const map = new Map();
  for (const line of lines) {
    try {
      const doc = JSON.parse(line);
      if (doc.$$deleted) {
        map.delete(doc._id);
      } else {
        map.set(doc._id, doc);
      }
    } catch {
      // skip malformed lines
    }
  }
  return [...map.values()];
}

/**
 * Extract level and XP from an actor document.
 * Handles D&D 5e and PF2e shapes. Falls back gracefully.
 */
function extractLevelXp(actor) {
  const sys = actor.system ?? actor.data ?? {};

  // D&D 5e
  if (sys.details?.level !== undefined) {
    return {
      level:   sys.details.level   ?? 1,
      xp:      sys.details.xp?.value ?? 0,
      xpNext:  sys.details.xp?.max   ?? 300,
    };
  }

  // PF2e
  if (sys.details?.level?.value !== undefined) {
    return { level: sys.details.level.value ?? 1, xp: 0, xpNext: 1000 };
  }

  return { level: 1, xp: 0, xpNext: 300 };
}

/**
 * Sync all PC-type actors from Foundry into player_characters.
 *
 * Only syncs actors of type "character" (PCs). NPCs/monsters are skipped.
 * Existing links (user_id) are never overwritten by the sync.
 *
 * @returns {{ synced: number, skipped: number, error: string|null }}
 */
export async function syncFoundryActors() {
  const dbPath = getActorsDbPath();
  if (!dbPath) {
    return { synced: 0, skipped: 0, error: 'FOUNDRY_DATA_PATH or FOUNDRY_WORLD not configured' };
  }

  let actors;
  try {
    actors = parseActorsDb(dbPath);
  } catch (err) {
    return { synced: 0, skipped: 0, error: `Failed to read actors.db: ${err.message}` };
  }

  // Only player characters
  const pcs = actors.filter(a =>
    (a.type === 'character' || a.type === 'PC') && a.name
  );

  let synced = 0;
  let skipped = 0;

  for (const actor of pcs) {
    try {
      const { level, xp, xpNext } = extractLevelXp(actor);

      const tokenImg   = actor.prototypeToken?.texture?.src ?? actor.token?.img ?? null;
      const portraitImg = actor.img ?? null;
      const biography  = actor.system?.details?.biography?.value
        ?? actor.data?.details?.biography?.value
        ?? null;

      await query(
        `INSERT INTO player_characters
           (foundry_actor_id, name, level, xp, xp_next, token_img, portrait_img, biography, system, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (foundry_actor_id) DO UPDATE
           SET name           = EXCLUDED.name,
               level          = EXCLUDED.level,
               xp             = EXCLUDED.xp,
               xp_next        = EXCLUDED.xp_next,
               token_img      = EXCLUDED.token_img,
               portrait_img   = EXCLUDED.portrait_img,
               biography      = EXCLUDED.biography,
               last_synced_at = NOW(),
               updated_at     = NOW()
           -- NEVER overwrite user_id or retired status from sync`,
        [actor._id, actor.name, level, xp, xpNext, tokenImg, portraitImg, biography, SYSTEM],
      );
      synced++;
    } catch (err) {
      console.error(`[foundrySync] Failed to upsert actor ${actor._id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[foundrySync] Sync complete: ${synced} synced, ${skipped} skipped`);
  return { synced, skipped, error: null };
}

/**
 * Start the periodic sync job (runs every 5 minutes).
 * Safe to call at startup — exits silently if not configured.
 */
export function startFoundrySync() {
  const configured = !!(process.env.FOUNDRY_DATA_PATH && process.env.FOUNDRY_WORLD);
  if (!configured) {
    console.log('[foundrySync] Not configured — skipping auto-sync (set FOUNDRY_DATA_PATH + FOUNDRY_WORLD to enable)');
    return;
  }

  // Initial sync at startup
  syncFoundryActors().catch(err =>
    console.error('[foundrySync] Initial sync failed:', err.message)
  );

  // Periodic sync every 5 minutes
  setInterval(() => {
    syncFoundryActors().catch(err =>
      console.error('[foundrySync] Periodic sync failed:', err.message)
    );
  }, 5 * 60 * 1000);

  console.log('[foundrySync] Auto-sync started (every 5 min)');
}
