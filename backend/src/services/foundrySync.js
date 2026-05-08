import { query } from '../db/index.js';

const SYSTEM =
  process.env.FOUNDRY_SYSTEM || 'dnd5e';

export async function upsertFoundryActors(actors = []) {
  if (!Array.isArray(actors)) {
    return {
      synced: 0,
      skipped: 0,
    };
  }

  let synced = 0;
  let skipped = 0;

  for (const actor of actors) {
    try {
      if (!actor?.id || !actor?.name) {
        skipped++;
        continue;
      }

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
          classe,
          race,
          retired,
          dead,
          retire_reason,
          origin,
          system,
          last_synced_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,$12,$13,
          'foundry',
          $14,
          NOW(),
          NOW()
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
          classe          = EXCLUDED.classe,
          race            = EXCLUDED.race,
          retired         = EXCLUDED.retired,
          dead            = EXCLUDED.dead,
          retire_reason   = EXCLUDED.retire_reason,
          last_synced_at  = NOW(),
          updated_at      = NOW()
        `,
        [
          actor.id,
          actor.name,
          actor.level ?? 1,
          actor.xp ?? 0,
          actor.xpNext ?? 300,
          actor.tokenImg ?? actor.img ?? null,
          actor.img ?? null,
          actor.biography ?? null,
          actor.classe ?? null,
          actor.race ?? null,
          actor.retired ?? false,
          actor.dead ?? false,
          actor.retireReason ?? null,
          SYSTEM,
        ],
      );

      if (actor.dead) {
        await query(
          `
          UPDATE player_characters
          SET dead_at = COALESCE(dead_at, NOW())
          WHERE foundry_actor_id = $1
            AND dead = TRUE
            AND dead_at IS NULL
          `,
          [actor.id],
        );
      }

      synced++;
    } catch (err) {
      console.error(
        '[foundrySync] Upsert failed:',
        actor?.name,
        err.message,
      );

      skipped++;
    }
  }

  console.log(
    `[foundrySync] Push sync complete: ${synced} synced, ${skipped} skipped`,
  );

  return {
    synced,
    skipped,
  };
}