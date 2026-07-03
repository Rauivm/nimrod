/**
 * services/actorResolution.js
 *
 * Resolução compartilhada de identidade: Foundry actor._id → usuário/personagem
 * Nimrod. Usada por qualquer rota que recebe dados originados do módulo
 * Foundry — hoje: POST /nimrod/session/presence e POST /sessions/:id/events.
 * Ambas usam exatamente a mesma função (resolveEventIdentity), evitando
 * duas implementações divergentes de uma mesma regra de negócio.
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
 * @returns {Promise<{ userId: string, characterId: string, actorName: string } | null>}
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

  return {
    userId:      res.rows[0].user_id,
    characterId: res.rows[0].character_id,
    actorName:   res.rows[0].name,
  };
}

/**
 * Resolução única de identidade para qualquer evento originado do Foundry
 * (presença ou evento de recurso). Usada por POST /nimrod/session/presence
 * e POST /sessions/:id/events — mesma regra, um único lugar.
 *
 * Prioridade de resolução:
 *   1. playerId explícito (chamada humana via UI do Nimrod) — não resolve
 *      nada, apenas valida/repassa; characterId/actorName completados se
 *      characterId for informado.
 *   2. actorId (módulo Foundry) → resolveActorOwnership() → userId +
 *      characterId + actorName. Regra estrita: só personagens sincronizados
 *      (foundry_actor_id preenchido) são resolvidos por este caminho.
 *   3. characterId explícito (sem actorId) → valida e deriva userId/actorName.
 *   4. Fallback: playerId + actorName informados por nome, sem characterId
 *      resolvido — busca personagem ativo do jogador com esse nome.
 *
 * @param {object} input
 * @param {string} [input.playerId]    - UUID do usuário Nimrod (chamada humana)
 * @param {string} [input.actorId]     - Foundry actor._id (chamada do módulo)
 * @param {string} [input.characterId] - UUID do personagem, se já conhecido
 * @param {string} [input.actorName]   - Nome do ator/personagem (fallback)
 *
 * @returns {Promise<{ playerId: string, characterId: string|null, actorName: string } | null>}
 *   null se não foi possível resolver playerId por nenhum caminho.
 */
export async function resolveEventIdentity({ playerId, actorId, characterId, actorName } = {}) {
  let resolvedPlayerId    = playerId ?? null;
  let resolvedCharacterId = characterId ?? null;
  let resolvedActorName   = actorName?.trim() || null;

  // 1. actorId é a via preferencial quando playerId não veio explícito —
  //    é o único caminho que o módulo Foundry usa hoje.
  if (!resolvedPlayerId && actorId) {
    const ownership = await resolveActorOwnership(actorId);
    if (!ownership) return null; // actorId não sincronizado — regra aceita do sistema

    resolvedPlayerId    = ownership.userId;
    resolvedCharacterId = resolvedCharacterId ?? ownership.characterId;
    resolvedActorName   = resolvedActorName   ?? ownership.actorName;
    return { playerId: resolvedPlayerId, characterId: resolvedCharacterId, actorName: resolvedActorName };
  }

  if (!resolvedPlayerId) return null;

  // 2. characterId explícito (chamada humana) — valida e deriva actorName
  if (resolvedCharacterId) {
    const charRes = await query(
      `SELECT id, name, user_id, active, retired, dead
       FROM player_characters
       WHERE id = $1`,
      [resolvedCharacterId],
    );
    if (!charRes.rows.length) return null;

    const ch = charRes.rows[0];
    if (ch.user_id !== resolvedPlayerId) return null;
    if (!ch.active || ch.retired || ch.dead) return null;

    resolvedActorName = ch.name;
    return { playerId: resolvedPlayerId, characterId: resolvedCharacterId, actorName: resolvedActorName };
  }

  // 3. Fallback: playerId + actorName por nome (sem characterId conhecido)
  if (resolvedActorName) {
    const byName = await query(
      `SELECT id
       FROM player_characters
       WHERE user_id = $1
         AND lower(name) = lower($2)
         AND active = TRUE AND retired = FALSE AND COALESCE(dead, FALSE) = FALSE
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [resolvedPlayerId, resolvedActorName],
    );
    resolvedCharacterId = byName.rows[0]?.id ?? null;
    return { playerId: resolvedPlayerId, characterId: resolvedCharacterId, actorName: resolvedActorName };
  }

  return null; // playerId presente mas sem forma de determinar actorName
}