/**
 * scripts/StructuralEvent.js
 *
 * Helper único para montar eventos ESTRUTURAIS — fatos sobre a sessão que
 * não são consumo de recurso (presença, cena, combate, tokens). Usado por
 * todos os *_HANDLERS que não lidam com HP/XP/ouro/etc.
 *
 * Por que resourceType='custom' + delta=0 + deltaMeta.snapshot=true:
 *   A infraestrutura atual (resource_deltas + POST /sessions/:id/events)
 *   já sabe lidar com "eventos sem variação numérica" — esse é exatamente
 *   o padrão criado para o snapshot de HP no fim de combate. Reaproveitamos
 *   o mesmo mecanismo em vez de criar uma tabela nova: o "fato" real do
 *   evento estrutural vive inteiro dentro de deltaMeta (JSONB), incluindo
 *   o `event_type` (ver EventTypes.js).
 *
 * deltaMeta.structural=true (além de snapshot=true) é o que sinaliza ao
 * backend que este evento pode não ter um actorId resolvível — nesse caso
 * o backend atribui o registro ao GM que abriu a sessão (session_logs.opened_by),
 * já que o evento descreve o estado da mesa, não a ação de um jogador
 * específico. Eventos com um ator real (ex: TOKEN_APPEARED de um NPC
 * específico) continuam preenchendo actorId normalmente quando disponível.
 *
 * NUNCA inclua descrições narrativas prontas aqui — apenas dados brutos.
 * A interpretação/narrativa é responsabilidade de um módulo futuro
 * (nimrod-narrative), não deste.
 */

/**
 * @param {string} eventType   - um dos valores de EventType (EventTypes.js)
 * @param {object} [fields]
 * @param {string} [fields.actorId]     - Foundry actor._id, se houver um ator específico
 * @param {string} [fields.actorName]
 * @param {object} [fields.data]        - payload específico do evento (estruturado, sem texto narrativo)
 * @returns {object} pronto para SessionSync.sendStructuralEvent()
 */
export function structuralEvent(eventType, fields = {}) {
  return {
    actorId:   fields.actorId   ?? null,
    actorName: fields.actorName ?? null,
    resourceType: 'custom',
    delta: 0,
    valueBefore: null,
    valueAfter: null,
    deltaMeta: {
      snapshot:   true,
      structural: true,
      event_type: eventType,
      world_id:   game.world?.id ?? null,
      scene_id:   canvas?.scene?.id ?? null,
      combat_id:  game.combat?.id ?? null,
      ...fields.data,
    },
    description: null, // nunca narrativo — ver aviso acima
  };
}