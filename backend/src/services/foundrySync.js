// nimrod/src/services/foundrySync.js
import { query } from '../db/index.js';

export async function upsertFoundryActors(actors) {
  if (!actors.length) return { upserted: 0, skipped: 0 };

  let upserted = 0;
  let skipped  = 0;

  for (const a of actors) {
    // modifiedAt nunca pode ser null/undefined — o WHERE do ON CONFLICT depende disso.
    // Se chegar sem o campo, usa o timestamp atual como fallback seguro.
    const modifiedAt = a.modifiedAt ?? Date.now();

    const result = await query(
      `
      INSERT INTO player_characters (
        foundry_actor_id,
        name,
        level,
        xp,
        xp_next,
        classe,
        race,
        biography,
        portrait_img,
        token_img,
        dead,
        retired,
        last_synced_at,
        updated_at,
        created_at,
        origin
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        now(),
        now(),
        now(),
        'foundry'
      )

      ON CONFLICT (foundry_actor_id)

      DO UPDATE SET
        name           = EXCLUDED.name,
        level          = EXCLUDED.level,
        xp             = EXCLUDED.xp,
        xp_next        = EXCLUDED.xp_next,
        classe         = EXCLUDED.classe,
        race           = EXCLUDED.race,
        biography      = EXCLUDED.biography,
        portrait_img   = EXCLUDED.portrait_img,
        token_img      = EXCLUDED.token_img,
        dead           = EXCLUDED.dead,
        retired        = EXCLUDED.retired,
        last_synced_at = now(),
        updated_at     = now()

      WHERE
        player_characters.last_synced_at IS NULL
        OR
        $13 >= EXTRACT(EPOCH FROM player_characters.last_synced_at) * 1000

      RETURNING id
      `,
      [
        a.id,
        a.name,
        a.level      ?? 1,
        a.xp         ?? 0,
        a.xpNext     ?? 300,
        a.classe     ?? null,
        a.race       ?? null,
        a.biography  ?? null,
        a.img        ?? null,
        a.tokenImg   ?? null,
        a.isDead     ?? false,
        a.isRetired  ?? false,
        modifiedAt,             // $13 — sempre um número válido
      ]
    );

    if (result.rowCount > 0) {
      upserted++;
    } else {
      skipped++;  // dado mais antigo que o que está no banco — ignorado intencionalmente
    }
  }

  return { upserted, skipped };
}
