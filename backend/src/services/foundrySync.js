import { createReadStream, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';
import cron from 'node-cron';
import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';

const DEFAULT_WORLD = process.env.FOUNDRY_WORLD || process.env.FOUNDRY_WORLD_ID || null;

function findFirstActorsDb(base) {
  const worldsDir = resolve(base, 'worlds');
  if (!existsSync(worldsDir)) return null;

  for (const world of readdirSync(worldsDir, { withFileTypes: true })) {
    if (!world.isDirectory()) continue;
    const candidate = resolve(worldsDir, world.name, 'packs', 'actors.db');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function actorDbPath() {
  const dataPath = process.env.FOUNDRY_DATA_PATH?.trim();
  if (!dataPath) return null;

  if (dataPath.endsWith('actors.db')) return resolve(dataPath);

  const world = DEFAULT_WORLD;
  const base = dataPath.endsWith('Data') ? dataPath : join(dataPath, 'Data');
  if (!world) return findFirstActorsDb(base);

  return resolve(base, 'worlds', world, 'packs', 'actors.db');
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickLevel(system = {}) {
  return asNumber(
    system.details?.level
      ?? system.attributes?.prof
      ?? system.details?.cr,
    1,
  );
}

function toText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ') || null;
  return value.label ?? value.name ?? value.value ?? null;
}

function pickXp(system = {}) {
  const xp = system.details?.xp;
  if (typeof xp === 'object' && xp !== null) return asNumber(xp.value, 0);
  return asNumber(xp, 0);
}

function pickXpNext(system = {}) {
  const xp = system.details?.xp;
  if (typeof xp === 'object' && xp !== null) {
    return asNumber(xp.max ?? xp.next, 300);
  }
  return 300;
}

function pickBiography(system = {}) {
  const bio = system.details?.biography;
  if (typeof bio === 'string') return bio;
  if (bio?.value) return String(bio.value);
  if (bio?.public) return String(bio.public);
  return null;
}

function pickTokenImg(actor = {}) {
  return actor.tokenImg ?? actor.token_img ?? actor.token?.img ?? actor.prototypeToken?.texture?.src ?? actor.prototypeToken?.img ?? null;
}

export function normalizeFoundryActor(actor) {
  const system = actor.system || {};
  const flags = actor.flags?.nimrod || {};
  return {
    id: actor._id ?? actor.id,
    name: actor.name,
    type: actor.type,
    img: actor.img ?? actor.portraitImg ?? actor.portrait_img ?? null,
    tokenImg: pickTokenImg(actor),
    level: asNumber(actor.level, pickLevel(system)),
    xp: asNumber(actor.xp, pickXp(system)),
    xpNext: asNumber(actor.xpNext ?? actor.xp_next, pickXpNext(system)),
    biography: actor.biography ?? pickBiography(system),
    classe: toText(actor.classe ?? system.details?.class ?? system.details?.classes),
    race: toText(actor.race ?? system.details?.race),
    isDead: !!(actor.isDead ?? actor.dead ?? flags.isDead),
    isRetired: !!(actor.isRetired ?? actor.retired ?? flags.isRetired),
    modifiedAt: actor._stats?.modifiedTime ?? actor.updatedAt ?? Date.now(),
  };
}

export async function readFoundryActorsDb() {
  const filePath = actorDbPath();
  if (!filePath || !existsSync(filePath)) {
    return { actors: [], source: filePath, available: false };
  }

  const actors = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    try {
      const actor = JSON.parse(text);
      if ((actor.type || 'character') !== 'character') continue;
      const normalized = normalizeFoundryActor(actor);
      if (normalized.id && normalized.name) actors.push(normalized);
    } catch {
      // Ignore malformed JSONL rows; one bad actor should not break sync.
    }
  }

  return { actors, source: filePath, available: true };
}

export async function upsertFoundryActors(actors, { markMissingInactive = false } = {}) {
  if (!actors.length) return { upserted: 0, skipped: 0, inactive: 0 };

  let upserted = 0;
  let skipped = 0;
  const ids = [];

  for (const raw of actors) {
    const a = normalizeFoundryActor(raw);
    if (!a.id || !a.name) {
      skipped++;
      continue;
    }
    ids.push(a.id);
    const modifiedAt = a.modifiedAt ?? Date.now();

    const result = await query(
      `INSERT INTO player_characters (
        foundry_actor_id, name, level, xp, xp_next, classe, race, biography,
        portrait_img, token_img, dead, retired, active, last_synced_at,
        updated_at, created_at, origin
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW(),NOW(),NOW(),'foundry')
      ON CONFLICT (foundry_actor_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        level = EXCLUDED.level,
        xp = EXCLUDED.xp,
        xp_next = EXCLUDED.xp_next,
        classe = EXCLUDED.classe,
        race = EXCLUDED.race,
        biography = EXCLUDED.biography,
        portrait_img = EXCLUDED.portrait_img,
        token_img = EXCLUDED.token_img,
        dead = EXCLUDED.dead,
        retired = EXCLUDED.retired,
        active = TRUE,
        last_synced_at = NOW(),
        updated_at = NOW(),
        origin = 'foundry'
      WHERE player_characters.last_synced_at IS NULL
         OR $13 >= EXTRACT(EPOCH FROM player_characters.last_synced_at) * 1000
      RETURNING id`,
      [
        a.id,
        a.name,
        a.level,
        a.xp,
        a.xpNext,
        a.classe,
        a.race,
        a.biography,
        a.img,
        a.tokenImg,
        a.isDead,
        a.isRetired,
        modifiedAt,
      ],
    );

    if (result.rowCount > 0) upserted++;
    else skipped++;
  }

  let inactive = 0;
  if (markMissingInactive && ids.length) {
    const inactiveRes = await query(
      `UPDATE player_characters
       SET active = FALSE, updated_at = NOW()
       WHERE origin = 'foundry'
         AND foundry_actor_id IS NOT NULL
         AND NOT (foundry_actor_id = ANY($1))
       RETURNING id`,
      [ids],
    );
    inactive = inactiveRes.rowCount;
  }

  return { upserted, skipped, inactive };
}

export async function syncFoundryActors() {
  const { actors, source, available } = await readFoundryActorsDb();
  if (!available) return { ok: false, source, upserted: 0, skipped: 0, inactive: 0 };

  const result = await upsertFoundryActors(actors, { markMissingInactive: true });
  broadcast('FOUNDRY_ACTORS_SYNCED', result);
  return { ok: true, source, ...result };
}

export function startFoundryActorSyncJob() {
  if (process.env.FOUNDRY_SYNC_DISABLED === 'true') return;
  cron.schedule('*/5 * * * *', () => {
    syncFoundryActors().catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[foundry-sync] sync failed:', err.message);
      }
    });
  });
}
