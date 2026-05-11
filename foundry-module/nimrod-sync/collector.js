const BUFFER = new Map();
const DEBOUNCE_MS = 2_000;
let flushTimeout = null;

export class SyncCollector {
  static collect(actor) {
    BUFFER.set(actor.id, serializeActor(actor));
    this.scheduleFlush();
  }

  static scheduleFlush() {
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  static async flush() {
    flushTimeout = null;
    const actors = Array.from(BUFFER.values());
    BUFFER.clear();
    if (!actors.length) return;

    try {
      const res = await fetch('http://127.0.0.1:3999/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actors }),
      });
      if (!res.ok) {
        console.error(`[nimrod-sync] Bridge rejeitou: ${res.status}`);
      } else {
        console.log(`[nimrod-sync] Flushed ${actors.length} actors`);
      }
    } catch (err) {
      // Bridge offline — re-bufferiza para próxima tentativa
      for (const a of actors) BUFFER.set(a.id, a);
      console.error('[nimrod-sync] Bridge inacessível, re-bufferizado:', err.message);
    }
  }
}

function serializeActor(actor) {
  const details = actor.system?.details ?? {};
  const xp      = details.xp ?? {};

  // dnd5e v4: classe vem de actor.classes (objeto keyed por ID)
  const classe = Object.values(actor.classes ?? {})[0]?.name ?? null;

  // dnd5e v4: raça vem de um item embedded do tipo 'race'
  const race =
    actor.items?.find(i => i.type === 'race')?.name ??
    details.type?.subtype ??   // fallback: subtype (ex: "Tiefling")
    null;

  return {
    id:        actor.id,
    name:      actor.name,
    img:       actor.img ?? null,
    tokenImg:  actor.prototypeToken?.texture?.src ?? actor.img ?? null,

    level:   details.level  ?? 1,
    xp:      xp.value       ?? 0,
    xpNext:  xp.max         ?? 300,

    classe,
    race,

    biography: details.biography?.value ?? null,

    isDead:    actor.flags?.['nimrod-sync']?.isDead    ?? false,
    isRetired: actor.flags?.['nimrod-sync']?.isRetired ?? false,

    modifiedAt: Date.now(),
  };
}