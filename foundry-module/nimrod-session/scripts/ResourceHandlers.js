/**
 * scripts/ResourceHandlers.js
 *
 * Registro central de recursos de personagem rastreados via updateActor.
 * Cada entrada em RESOURCE_HANDLERS descreve TUDO que main.js precisa
 * saber sobre um recurso — main.js não conhece HP, XP, ouro ou spell slot
 * individualmente, apenas itera sobre este registro.
 *
 * Contrato de um handler:
 *
 *   path       {string}
 *     Caminho dot-notation sob `changes.system` usado para detectar se
 *     este recurso foi tocado nesta atualização (via foundry.utils.getProperty).
 *
 *   snapshot(actor) → any
 *     Captura o estado ANTES da mudança, chamado no hook `preUpdateActor`
 *     (quando `actor` ainda reflete o estado pré-update). O formato do
 *     retorno é livre — só o próprio handler precisa entender.
 *
 *   complete(actor, changes, pre) → ResourceEvent[]
 *     Chamado no hook `updateActor` (quando `actor` já reflete o estado
 *     PÓS-update). Recebe o snapshot pré-update capturado por snapshot()
 *     (ou undefined se não havia). Retorna 0, 1 ou N eventos prontos para
 *     envio — a maioria dos recursos retorna no máximo 1, mas recursos
 *     multi-valor (ex: spell_slot, com vários níveis simultâneos) podem
 *     retornar vários na mesma atualização.
 *
 * ── Adicionar um novo recurso rastreável (ex: Inspiration, Hit Dice,
 *    Exhaustion, Death Saves) ──
 *   1. Adicione uma entrada aqui com path/snapshot/complete.
 *   2. Nada em main.js precisa mudar.
 *
 * ── O que NÃO está aqui ──
 *   Itens de inventário (createItem/deleteItem) não seguem este padrão —
 *   eles são detectados no próprio evento do hook (o item já existe/já foi
 *   removido no momento da detecção), sem necessidade de snapshot
 *   pré-update. Continuam em EventDetector.js (fromItemCreate/fromItemDelete).
 */

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Helper compartilhado para recursos de valor único (gold, hp, xp, e cada
 * slot individual de spell_slot). Calcula delta a partir de before/after;
 * retorna null se não houver snapshot disponível ou se o valor não mudou.
 *
 * @param {string}   resourceType
 * @param {number|null|undefined} before
 * @param {number}   after
 * @param {object}   deltaMeta
 * @param {(delta:number) => string} describe
 * @returns {object|null}
 */
function completeSimple(resourceType, before, after, deltaMeta, describe) {
  if (before === null || before === undefined) return null;
  const delta = round2(after - before);
  if (delta === 0) return null;
  return {
    resourceType,
    delta,
    valueBefore: round2(before),
    valueAfter:  round2(after),
    deltaMeta:   deltaMeta ?? {},
    description: describe(delta),
  };
}

/** Soma o valor de moedas em peças de ouro equivalentes (dnd5e). */
function sumCurrency(currency) {
  const RATES = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };
  return Object.entries(currency ?? {}).reduce((s, [c, v]) => s + Number(v) * (RATES[c] ?? 0), 0);
}

export const RESOURCE_HANDLERS = {

  gold: {
    path: 'currency',
    snapshot: (actor) => ({ ...actor.system?.currency }),
    complete: (actor, changes, pre) => {
      const before = pre ? sumCurrency(pre) : null;
      const after  = sumCurrency(actor.system?.currency ?? {});
      const ev = completeSimple('gold', before, after, {}, (d) =>
        d < 0 ? `Gastou ${Math.abs(d)} po (${actor.name})` : `Recebeu ${d} po (${actor.name})`);
      return ev ? [ev] : [];
    },
  },

  hp: {
    path: 'attributes.hp',
    snapshot: (actor) => ({ ...actor.system?.attributes?.hp }),
    complete: (actor, changes, pre) => {
      const before = pre ? Number(pre.value ?? 0) : null;
      const after  = Number(actor.system?.attributes?.hp?.value ?? 0);
      const maxHp  = Number(actor.system?.attributes?.hp?.max ?? 0);
      const ev = completeSimple('hp', before, after, { max_hp: maxHp }, (d) =>
        d < 0 ? `${actor.name} perdeu ${Math.abs(d)} HP` : `${actor.name} recuperou ${d} HP`);
      return ev ? [ev] : [];
    },
  },

  xp: {
    path: 'details.xp',
    snapshot: (actor) => Number(actor.system?.details?.xp?.value ?? 0),
    complete: (actor, changes, pre) => {
      const before = (pre === null || pre === undefined) ? null : pre;
      const after  = Number(actor.system?.details?.xp?.value ?? 0);
      const ev = completeSimple('xp', before, after, {}, (d) =>
        d > 0 ? `+${d} XP (${actor.name})` : `${d} XP (${actor.name})`);
      return ev ? [ev] : [];
    },
  },

  // Multi-valor: um único `changes.system.spells` pode tocar vários níveis
  // de slot na mesma atualização (ex: descanso longo recupera todos de uma
  // vez) — por isso complete() retorna um array com 0..N eventos.
  spell_slot: {
    path: 'spells',
    snapshot: (actor) => foundry.utils.deepClone(actor.system?.spells ?? {}),
    complete: (actor, changes, pre) => {
      const spellChanges = changes?.system?.spells ?? {};
      const events = [];

      for (const key of Object.keys(spellChanges)) {
        const match = key.match(/^spell(\d+)$/) ?? (key === 'pact' ? ['pact', 'pact'] : null);
        if (!match) continue;

        const slotLevel = key === 'pact' ? 'pact' : Number(match[1]);
        const before     = pre?.[key]?.value;
        const after       = Number(actor.system?.spells?.[key]?.value ?? 0);

        const ev = completeSimple('spell_slot', before, after, { slot_level: slotLevel }, (d) =>
          d < 0
            ? `Usou espaço de magia nível ${slotLevel} (${actor.name})`
            : `Recuperou espaço de magia nível ${slotLevel} (${actor.name})`);
        if (ev) events.push(ev);
      }

      return events;
    },
  },
};