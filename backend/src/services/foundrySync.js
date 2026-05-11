// nimrod/src/services/foundrySync.js
import { query } from '../db/index.js';

export async function upsertFoundryActors(actors) {
  if (!actors.length) return { upserted: 0, skipped: 0 };

  let upserted = 0;
  let skipped  = 0;

  for (const a of actors) {
    const result = await query(
      `UPDATE player_characters
       SET
         name           = $1,
         level          = $2,
         xp             = $3,
         xp_next        = $4,
         classe         = $5,
         race           = $6,
         biography      = $7,
         portrait_img   = $8,
         token_img      = $9,
         dead           = $10,
         retired        = $11,
         last_synced_at = now(),
         updated_at     = now()
       WHERE foundry_actor_id = $12
         AND (
           last_synced_at IS NULL
           OR $13 >= EXTRACT(EPOCH FROM last_synced_at) * 1000
         )
       RETURNING id`,
      [
        a.name,
        a.level      ?? 1,
        a.xp         ?? 0,
        a.xpNext     ?? 300,
        a.classe     ?? null,
        a.race       ?? null,
        a.biography  ?? null,
        a.img        ?? null,      // portrait_img
        a.tokenImg   ?? null,      // token_img
        a.isDead     ?? false,     // dead
        a.isRetired  ?? false,     // retired
        a.id,                      // foundry_actor_id
        a.modifiedAt,              // last-write-wins guard
      ]
    );

    if (result.rowCount > 0) {
      upserted++;
    } else {
      skipped++;  // não encontrou foundry_actor_id ou era dado mais antigo
    }
  }

  return { upserted, skipped };
}