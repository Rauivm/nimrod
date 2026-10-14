/**
 * scripts/EventDetector.js
 *
 * Responsabilidade única (reduzida): detectar eventos de item de inventário
 * (createItem/deleteItem). Esses eventos são completos no momento da
 * detecção — o item já existe (create) ou já foi removido (delete) quando
 * o hook dispara, sem precisar de snapshot pré-update.
 *
 * Recursos de personagem (HP, XP, ouro, spell slots), que EXIGEM snapshot
 * pré-update para calcular delta corretamente, NÃO estão mais aqui — foram
 * migrados para o registro RESOURCE_HANDLERS em ResourceHandlers.js, que
 * unifica detecção (path), snapshot e cálculo de delta (complete) num só
 * lugar por recurso. Ver ResourceHandlers.js para adicionar novos recursos
 * de personagem (Inspiration, Hit Dice, Exhaustion, Death Saves, etc.).
 *
 * Exporta:
 *   EventDetector.fromItemCreate(actor, item) → ResourceEvent | null
 *   EventDetector.fromItemDelete(actor, item) → ResourceEvent | null
 *
 * ResourceEvent:
 *   { resourceType, delta, valueBefore, valueAfter, deltaMeta, description }
 */

const TRACKED_ITEM_TYPES = ['weapon', 'equipment', 'consumable', 'loot', 'tool'];

export class EventDetector {

  static snapshotItem(item) {
    if (!TRACKED_ITEM_TYPES.includes(item.type)) return null;

    return {
      quantity: Number(item.system?.quantity ?? 1),
      usesValue: item.system?.uses?.value != null ? Number(item.system.uses.value) : null,
      equipped: item.system?.equipped ?? null,
      attuned: item.system?.attuned ?? null,
      itemName: item.name,
      itemId: item.id,
      itemType: item.type,
      itemSubtype: item.system?.type?.value ?? null,
    };
  }

  /**
   * Detecta evento ao criar um item no inventário.
   *
   * @param {Actor} actor
   * @param {Item}  item
   * @returns {ResourceEvent | null}
   */
  static fromItemCreate(actor, item) {
    if (!TRACKED_ITEM_TYPES.includes(item.type)) return null;

    const isPotion      = item.type === 'consumable' && item.system?.type?.value === 'potion';
    const qty            = Number(item.system?.quantity ?? 1);
    const resourceType   = isPotion ? 'potion' : 'item';

    return {
      resourceType,
      delta:       qty,
      valueBefore: null,
      valueAfter:  null,
      deltaMeta: {
        item_name:    item.name,
        item_id:      item.id,
        item_type:    item.type,
        item_subtype: item.system?.type?.value ?? null,
      },
      description: `Recebeu ${qty > 1 ? `${qty}x ` : ''}${item.name} (${actor.name})`,
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
    if (!TRACKED_ITEM_TYPES.includes(item.type)) return null;

    const isPotion      = item.type === 'consumable' && item.system?.type?.value === 'potion';
    const qty            = Number(item.system?.quantity ?? 1);
    const resourceType   = isPotion ? 'potion' : 'item';

    return {
      resourceType,
      delta:       -qty,
      valueBefore: null,
      valueAfter:  null,
      deltaMeta: {
        item_name:    item.name,
        item_id:      item.id,
        item_type:    item.type,
        item_subtype: item.system?.type?.value ?? null,
      },
      description: `Usou/removeu ${qty > 1 ? `${qty}x ` : ''}${item.name} (${actor.name})`,
    };
  }

  static fromItemUpdate(actor, item, pre) {
    if (!pre || !TRACKED_ITEM_TYPES.includes(item.type)) {
      return { resourceEvents: [], sessionEvents: [] };
    }

    const isPotion = item.type === 'consumable' && item.system?.type?.value === 'potion';
    const resourceType = isPotion ? 'potion' : 'item';
    const itemMeta = {
      item_name: item.name,
      item_id: item.id,
      item_type: item.type,
      item_subtype: item.system?.type?.value ?? null,
    };

    const resourceEvents = [];
    const sessionEvents = [];
    const quantity = Number(item.system?.quantity ?? 1);
    const quantityDelta = quantity - Number(pre.quantity ?? 1);

    if (quantityDelta !== 0) {
      resourceEvents.push({
        resourceType,
        delta: quantityDelta,
        valueBefore: Number(pre.quantity ?? 1),
        valueAfter: quantity,
        deltaMeta: { ...itemMeta, change_type: 'quantity' },
        description: quantityDelta > 0
          ? `Recebeu ${quantityDelta}x ${item.name} (${actor.name})`
          : `Usou/removeu ${Math.abs(quantityDelta)}x ${item.name} (${actor.name})`,
      });
    }

    const usesValue = item.system?.uses?.value != null ? Number(item.system.uses.value) : null;
    if (pre.usesValue != null && usesValue != null) {
      const usesDelta = usesValue - Number(pre.usesValue);
      if (usesDelta !== 0) {
        resourceEvents.push({
          resourceType: 'item',
          delta: usesDelta,
          valueBefore: Number(pre.usesValue),
          valueAfter: usesValue,
          deltaMeta: { ...itemMeta, change_type: 'uses' },
          description: usesDelta > 0
            ? `Recuperou ${usesDelta} carga(s) de ${item.name} (${actor.name})`
            : `Usou ${Math.abs(usesDelta)} carga(s) de ${item.name} (${actor.name})`,
        });
      }
    }

    const equipped = item.system?.equipped ?? null;
    if (pre.equipped !== null && equipped !== null && pre.equipped !== equipped) {
      sessionEvents.push({
        eventType: equipped ? 'ITEM_EQUIPPED' : 'ITEM_UNEQUIPPED',
        payload: { ...itemMeta, equipped },
      });
    }

    const attuned = item.system?.attuned ?? null;
    if (pre.attuned !== null && attuned !== null && pre.attuned !== attuned) {
      sessionEvents.push({
        eventType: attuned ? 'ITEM_ATTUNED' : 'ITEM_UNATTUNED',
        payload: { ...itemMeta, attuned },
      });
    }

    return { resourceEvents, sessionEvents };
  }
}
