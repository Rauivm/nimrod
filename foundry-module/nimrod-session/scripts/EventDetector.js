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
}