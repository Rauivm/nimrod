/**
 * collector.js
 *
 * Responsabilidades:
 *  - Serializar actors do dnd5e v4 corretamente
 *  - Debounce de eventos incrementais (createActor / updateActor)
 *  - Flush para o bridge local em http://127.0.0.1:3999/sync
 *
 * EXPORTA serializeActor para uso em nimrod-sync.js (syncAllActors)
 */

const BRIDGE_URL  = 'http://127.0.0.1:3999';
const DEBOUNCE_MS = 2_000;

const BUFFER       = new Map();
let   flushTimeout = null;

// ── Serialização ──────────────────────────────────────────────────────────────

export function serializeActor(actor) {
  const sys     = actor.system  ?? {};
  const details = sys.details   ?? {};
  const xp      = details.xp   ?? {};

  // Nível: soma de todas as classes (multiclass) ou fallback para details.level
  const classItems = actor.items?.filter(i => i.type === 'class') ?? [];

  const level = classItems.length > 0
    ? classItems.reduce((sum, cls) => sum + (Number(cls.system?.levels) || 0), 0)
    : Number(details.level ?? 1);

  // Classe: todas as classes separadas por vírgula (multiclass)
  const classe = classItems.length > 0
    ? classItems.map(c => c.name).join(', ')
    : (Object.values(actor.classes ?? {})[0]?.name ?? null);

  // Raça: item embedded do tipo 'race' → fallback subtype → fallback legacy field
  const raceItem = actor.items?.find(i => i.type === 'race');
  const race     = raceItem?.name
    ?? details.type?.subtype
    ?? (typeof details.race === 'string' ? details.race : null)
    ?? null;

  // Flags de estado (definidas via actor.update no Foundry ou via GM)
  const flags = actor.flags?.['nimrod-sync'] ?? {};

  return {
    id:         actor.id,
    name:       actor.name,
    img:        actor.img        ?? null,
    tokenImg:   actor.prototypeToken?.texture?.src ?? actor.img ?? null,
    level,
    xp:         Number(xp.value  ?? 0),
    xpNext:     Number(xp.max    ?? 300),
    classe,
    race,
    biography:  details.biography?.value ?? null,
    isDead:     Boolean(flags.isDead    ?? false),
    isRetired:  Boolean(flags.isRetired ?? false),
    modifiedAt: Date.now(),   // sempre um número válido — nunca null/undefined
  };
}

// ── Collector (sync incremental) ──────────────────────────────────────────────

export class SyncCollector {
  static collect(actor) {
    BUFFER.set(actor.id, serializeActor(actor));
    this.scheduleFlush();
  }

  static scheduleFlush() {
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  // Cancela o timeout pendente — usado antes de um flush forçado
  // para evitar que o timer dispare logo depois e faça um flush vazio.
  static cancelPendingFlush() {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
  }

  static async flush() {
    flushTimeout = null;

    const actors = Array.from(BUFFER.values());
    BUFFER.clear();
    if (!actors.length) return;

    try {
      const res = await fetch(`${BRIDGE_URL}/sync`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ actors }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[nimrod-sync] Bridge rejeitou /sync ${res.status}: ${body.slice(0, 200)}`);
        // Re-bufferiza para próxima tentativa
        for (const a of actors) BUFFER.set(a.id, a);
      } else {
        console.log(`[nimrod-sync] Incremental flush: ${actors.length} actor(s)`);
      }
    } catch (err) {
      // Bridge offline — re-bufferiza
      for (const a of actors) BUFFER.set(a.id, a);
      console.error('[nimrod-sync] Bridge inacessível, re-bufferizado:', err.message);
    }
  }
}
