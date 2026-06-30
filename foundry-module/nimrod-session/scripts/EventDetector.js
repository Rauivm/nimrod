/**
 * scripts/EventDetector.js
 *
 * Responsabilidade única: dado um actor + o objeto `changes` do hook
 * `updateActor`, extrair zero ou mais eventos de recurso para enviar
 * ao backend Nimrod.
 *
 * Suporta dnd5e v4 (sistema ativo no nimrod-sync). Campos mapeados:
 *
 *   system.currency.*          → gold (soma de todas as moedas em peças de ouro)
 *   system.details.xp.value   → xp
 *   system.attributes.hp.*    → hp (value, temp, tempmax)
 *   system.spells.spell*.value → spell_slot (por nível)
 *   items (createItem)         → item / potion detectado por subtipo
 *   items (deleteItem)         → item / potion consumido
 *
 * Exporta:
 *   EventDetector.fromActorUpdate(actor, changes) → ResourceEvent[]
 *   EventDetector.fromItemCreate(actor, item)     → ResourceEvent | null
 *   EventDetector.fromItemDelete(actor, item)     → ResourceEvent | null
 *
 * ResourceEvent:
 *   { resourceType, delta, valueBefore, valueAfter, deltaMeta, description }
 */

// Taxas de conversão de moedas dnd5e → peças de ouro (valor padrão do sistema)
const CURRENCY_TO_GOLD = {
  pp: 10,   // platina → 10 po
  gp:  1,   // ouro → 1 po
  ep:  0.5, // electrum → 0.5 po
  sp:  0.1, // prata → 0.1 po
  cp:  0.01,// cobre → 0.01 po
};

export class EventDetector {

  /**
   * Detecta eventos a partir do hook `updateActor`.
   *
   * @param {Actor}  actor   - Actor atualizado (estado pós-update)
   * @param {object} changes - Delta reportado pelo Foundry (pode ser profundo)
   * @returns {ResourceEvent[]}
   */
  static fromActorUpdate(actor, changes) {
    const events = [];
    const sys = changes?.system ?? {};
    console.log(
      "CHANGES JSON",
      JSON.stringify(changes, null, 2)
    );


    // ── 1. Ouro (moedas) ──────────────────────────────────────────────────────
    if (sys.currency) {
      const event = this.#detectCurrency(actor, sys.currency);
      if (event) events.push(event);
    }

    // ── 2. XP ─────────────────────────────────────────────────────────────────
    const xpNew = sys.details?.xp?.value;
    if (xpNew !== undefined && xpNew !== null) {
      const xpOld = actor.system?.details?.xp?.value ?? 0;
      const delta  = Number(xpNew) - Number(xpOld);
      if (delta !== 0) {
        events.push({
          resourceType: "xp",
          delta,
          valueBefore:  Number(xpOld),
          valueAfter:   Number(xpNew),
          deltaMeta:    {},
          description:  delta > 0
            ? `+${delta} XP (${actor.name})`
            : `${delta} XP (${actor.name})`,
        });
      }
    }

    // ── 3. HP ─────────────────────────────────────────────────────────────────
    const hpChanges = sys.attributes?.hp ?? {};
    if (Object.keys(hpChanges).length > 0) {
      const hpEvent = this.#detectHp(actor, hpChanges);
      if (hpEvent) events.push(hpEvent);
    }

    // ── 4. Espaços de magia ───────────────────────────────────────────────────
    const spellChanges = sys.spells ?? {};
    for (const [key, val] of Object.entries(spellChanges)) {
      // key = "spell1" … "spell9" | "pact"
      const match = key.match(/^spell(\d+)$/) ?? (key === "pact" ? ["pact", "pact"] : null);
      if (!match) continue;

      const slotLevel = key === "pact" ? "pact" : Number(match[1]);
      const newValue  = val?.value;
      if (newValue === undefined || newValue === null) continue;

      const oldSlots = actor.system?.spells?.[key] ?? {};
      const oldValue = Number(oldSlots.value ?? 0);
      const delta    = Number(newValue) - oldValue;
      if (delta === 0) continue;

      events.push({
        resourceType: "spell_slot",
        delta,
        valueBefore:  oldValue,
        valueAfter:   Number(newValue),
        deltaMeta:    { slot_level: slotLevel },
        description:  delta < 0
          ? `Usou espaço de magia nível ${slotLevel === "pact" ? "pact" : slotLevel} (${actor.name})`
          : `Recuperou espaço de magia nível ${slotLevel === "pact" ? "pact" : slotLevel} (${actor.name})`,
      });
    }
    // ── 5. Nome ────────────────────────────────────────────────
    if (changes.name !== undefined && changes.name !== actor.name) {
        events.push({
            resourceType: "name",
            delta: 0,
            valueBefore: actor.name,
            valueAfter: changes.name,
            description: `${actor.name} foi renomeado para ${changes.name}`,
        });
    }

    // ── 6. Raça ────────────────────────────────────────────────
    const race = changes.system?.details?.race;

    if (race !== undefined) {
        events.push({
            resourceType: "race",
            valueBefore: actor.system.details.race,
            valueAfter: race,
            delta: 0,
            description: `Raça alterada`,
        });
    }

    const { currency, abilities, attributes, details } = sys;

    if (currency) console.log("Moedas alteradas:", currency);
    if (abilities) console.log("Atributos alterados:", abilities);
    if (attributes) console.log("Status (HP/AC) alterados:", attributes);

    console.log("EVENTS", events);

    return events;
  }

  /**
   * Detecta evento ao criar um item no inventário.
   * Captura: itens comuns, poções, equipamentos.
   *
   * @param {Actor} actor
   * @param {Item}  item
   * @returns {ResourceEvent | null}
   */
  static fromItemCreate(actor, item) {
    // Ignora itens que não são do inventário relevante
    if (!["weapon", "equipment", "consumable", "loot", "tool"].includes(item.type)) return null;

    const isPotion   = item.type === "consumable" && item.system?.type?.value === "potion";
    const qty        = Number(item.system?.quantity ?? 1);
    const resourceType = isPotion ? "potion" : "item";

    return {
      resourceType,
      delta:       qty,
      valueBefore: null,
      valueAfter:  null,
      deltaMeta:   {
        item_name:  item.name,
        item_id:    item.id,
        item_type:  item.type,
        item_subtype: item.system?.type?.value ?? null,
      },
      description: `Recebeu ${qty > 1 ? `${qty}x ` : ""}${item.name} (${actor.name})`,
    };
  }

  /**
   * Detecta evento ao deletar/consumir um item do inventário.
   *
   * @param {Actor} actor
   * @param {Item}  item
   * @returns {ResourceEvent | null}
   */
  static fromItemDelete(actor, item) {
    if (!["weapon", "equipment", "consumable", "loot", "tool"].includes(item.type)) return null;

    const isPotion    = item.type === "consumable" && item.system?.type?.value === "potion";
    const qty         = Number(item.system?.quantity ?? 1);
    const resourceType = isPotion ? "potion" : "item";

    return {
      resourceType,
      delta:       -qty,
      valueBefore: null,
      valueAfter:  null,
      deltaMeta:   {
        item_name:    item.name,
        item_id:      item.id,
        item_type:    item.type,
        item_subtype: item.system?.type?.value ?? null,
      },
      description: `Usou/removeu ${qty > 1 ? `${qty}x ` : ""}${item.name} (${actor.name})`,
    };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Converte o delta de moedas em peças de ouro equivalentes.
   * Compara o estado atual do actor com os novos valores parciais em `currencyChanges`.
   */
  static #detectCurrency(actor, currencyChanges) {
    const currentCurrency = actor.system?.currency ?? {};

    // Calcula total atual EM OURO (antes do update)
    // O actor neste ponto já recebeu o update, então usamos o "before"
    // reconstruído: estado atual menos os deltas reportados
    let goldBefore = 0;
    let goldAfter  = 0;

    for (const [coin, rate] of Object.entries(CURRENCY_TO_GOLD)) {
      const after  = Number(currencyChanges[coin] ?? currentCurrency[coin] ?? 0);
      // "before" = valor atual (pós-update) menos o delta desta moeda específica
      const before = currencyChanges[coin] !== undefined
        ? Number(currentCurrency[coin] ?? 0) // atual já é o after; o before foi o que estava antes
        : Number(currentCurrency[coin] ?? 0);

      // Para calcular corretamente o before, precisamos que `changes` tenha o novo valor
      // e o actor já tenha sido atualizado. Reconstruímos assim:
      //   goldAfter  = soma do currentCurrency (já reflete o update)
      //   goldBefore = goldAfter - delta desta moeda
      goldAfter += Number(currentCurrency[coin] ?? 0) * rate;

      // Se a moeda mudou, o antes era currentCurrency[coin] - delta desta moeda
      if (currencyChanges[coin] !== undefined) {
        const oldValue = Number(currentCurrency[coin] ?? 0) - (Number(currencyChanges[coin]) - Number(currentCurrency[coin] ?? 0));
        // Simplificação: usamos o valor reportado em changes como novo valor
        goldBefore += Number(currentCurrency[coin] ?? 0) * rate; // será ajustado abaixo
      } else {
        goldBefore += Number(currentCurrency[coin] ?? 0) * rate;
      }
    }

    // Abordagem mais simples e correta: calcular a variação direto das mudanças
    let deltaGold = 0;
    for (const [coin, newVal] of Object.entries(currencyChanges)) {
      const rate   = CURRENCY_TO_GOLD[coin];
      if (!rate) continue;
      // O actor já foi atualizado, então currentCurrency[coin] === newVal
      // Precisamos do valor antigo: não temos acesso direto, mas o
      // hook updateActor no Foundry v13 garante que `changes` contém
      // apenas os campos que mudaram, com o novo valor.
      // Para calcular o delta de ouro, usamos apenas a diferença explícita:
      // não temos o "before" aqui, mas o EventDetector é chamado com o actor
      // pré-update (veja main.js — captura o before antes do hook processar).
      deltaGold += Number(newVal) * rate;
    }

    // Se não houve mudança real, ignora
    if (deltaGold === 0) return null;

    return {
      resourceType: "gold",
      delta:        Math.round(deltaGold * 100) / 100, // arredonda centavos de platina
      valueBefore:  null, // preenchido em main.js com snapshot pré-update
      valueAfter:   null, // preenchido em main.js com snapshot pós-update
      deltaMeta:    { currencies: currencyChanges },
      description:  `Mudança de ouro (${actor.name})`,
    };
  }

  /**
   * Detecta mudança de HP (value, temp, tempmax).
   */
  static #detectHp(actor, hpChanges) {
    const newHp = hpChanges.value;

    if (newHp === undefined || newHp === null) {
        return null;
    }

    return {
        resourceType: "hp",
        delta: null,
        valueBefore: null,
        valueAfter: Number(newHp),
        deltaMeta: {},
        description: `${actor.name} HP alterado`,
    };
  }
}
