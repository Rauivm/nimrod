/**
 * services/actorResolution.js
 *
 * Resolução compartilhada de identidade: Foundry actor._id → usuário/personagem
 * Nimrod. Usada por qualquer rota que recebe dados originados do módulo
 * Foundry (eventos de recurso, presença, futuras integrações).
 *
 * Fonte da verdade: player_characters.foundry_actor_id.
 *
 * IMPORTANTE — dependência de sincronização:
 *   Esta resolução só funciona para personagens que já foram sincronizados
 *   pelo menos uma vez com o Foundry (foundry_actor_id preenchido via
 *   POST /foundry/push-actors ou pelo cron de sync). Um personagem criado
 *   no Nimrod mas nunca sincronizado não tem foundry_actor_id — nenhum
 *   evento vindo do Foundry para esse actor será resolvido, e a chamada
 *   retornará null. Essa é uma regra aceita do sistema, não um bug: só
 *   personagens sincronizados podem gerar eventos automáticos de sessão.
 */

import { query } from '../db/index.js';

/**
 * Resolve um Foundry actor._id para o usuário e personagem Nimrod
 * correspondentes.
 *
 * @param {string} actorId - Foundry actor._id
 * @returns {Promise<{ userId: string, characterId: string, characterName: string } | null>}
 *   null se o actorId não tem personagem sincronizado (ou não é um
 *   personagem ativo/válido).
 */
export async function resolveActorOwnership(actorId) {
  if (!actorId) return null;

  const res = await query(
    `SELECT pc.id AS character_id, pc.user_id, pc.name
     FROM player_characters pc
     WHERE pc.foundry_actor_id = $1
       AND pc.active = TRUE
       AND pc.retired = FALSE
       AND COALESCE(pc.dead, FALSE) = FALSE
     LIMIT 1`,
    [actorId],
  );

  if (!res.rows.length) return null;
  const row = res.rows[0];

  return {
    userId: row.user_id,
    characterId: row.character_id,
    actorName: row.name,
    actorId,
  };
}