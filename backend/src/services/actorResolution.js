/**
 * services/actorResolution.js
 *
 * Resolução compartilhada de identidade: Foundry actor._id (ou nome de
 * usuário Foundry) → usuário/personagem Nimrod. Fonte única usada por
 * TODO evento originado do módulo Foundry — resource_deltas (via
 * /sessions/:id/events) e session_events (via /sessions/:id/session-events,
 * incluindo presença). Nenhuma rota implementa sua própria cascata de
 * resolução.
 *
 * Fonte da verdade: player_characters.foundry_actor_id.
 *
 * IMPORTANTE — dependência de sincronização:
 *   Esta resolução só funciona para personagens que já foram sincronizados
 *   pelo menos uma vez com o Foundry (foundry_actor_id preenchido via
 *   POST /foundry/push-actors ou pelo cron de sync). Um personagem criado
 *   no Nimrod mas nunca sincronizado não tem foundry_actor_id — nenhum
 *   evento vindo do Foundry para esse actor será resolvido por esse tier.
 *   Essa é uma regra aceita do sistema para resource_deltas (estrita).
 *   Para session_events, resolveEventIdentity tem um tier adicional
 *   (foundryName) que permite resolução por identidade humana quando não
 *   há personagem sincronizado — ver essa função para detalhes.
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
 * (presença, evento de recurso, ou evento estrutural em session_events).
 * Um único lugar, uma única regra — nenhum chamador implementa sua própria
 * cascata de resolução.
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
 *   5. Fallback final (só quando `foundryName` é informado): resolução
 *      "melhor esforço" por identidade humana, sem exigir personagem
 *      sincronizado — usada quando os tiers acima falham (ex: GM sem
 *      personagem, ou jogador ainda sem foundry_actor_id preenchido).
 *        a. user_foundry_map.actor_name = actorName ou foundryName
 *        b. users.name / display_name = foundryName
 *      Esse tier é deliberadamente mais permissivo — legítimo para
 *      presença (rastrear quem está online não deveria exigir sync prévio)
 *      e disponível a qualquer chamador que informe foundryName.
 *
 * @param {object} input
 * @param {string} [input.playerId]     - UUID do usuário Nimrod (chamada humana)
 * @param {string} [input.actorId]      - Foundry actor._id (chamada do módulo)
 * @param {string} [input.characterId]  - UUID do personagem, se já conhecido
 * @param {string} [input.actorName]    - Nome do ator/personagem (fallback)
 * @param {string} [input.foundryName]  - Nome de usuário Foundry (game.user.name) — habilita o tier 5
 *
 * @returns {Promise<{ playerId: string, characterId: string|null, actorName: string|null } | null>}
 *   null se não foi possível resolver playerId por nenhum caminho.
 */
export async function resolveEventIdentity({ playerId, actorId, characterId, actorName, foundryName } = {}) {
  let resolvedPlayerId    = playerId ?? null;
  let resolvedCharacterId = characterId ?? null;
  let resolvedActorName   = actorName?.trim() || null;

  // 1/2. actorId é a via preferencial quando playerId não veio explícito —
  //      é o caminho que o módulo Foundry usa para eventos de recurso.
  if (!resolvedPlayerId && actorId) {
    const ownership = await resolveActorOwnership(actorId);
    if (ownership) {
      return {
        playerId:    ownership.userId,
        characterId: resolvedCharacterId ?? ownership.characterId,
        actorName:   resolvedActorName   ?? ownership.actorName,
      };
    }
    // actorId não sincronizado — cai para o tier 5 (foundryName) antes de
    // desistir, em vez de retornar null imediatamente.
  }

  if (!resolvedPlayerId) {
    // 5. Fallback final por foundryName — só tentado aqui (sem playerId e
    // sem resolução por actorId) para não mascarar erros de digitação em
    // chamadas que deveriam ter resolvido por um caminho mais estrito.
    if (foundryName) {
      const lookupName = resolvedActorName ?? foundryName;

      const fmRes = await query(
        `SELECT u.id AS user_id
         FROM user_foundry_map fm
         JOIN users u ON u.email = fm.email
         WHERE LOWER(fm.actor_name) = LOWER($1)
         LIMIT 1`,
        [lookupName],
      );
      if (fmRes.rows.length) {
        return { playerId: fmRes.rows[0].user_id, characterId: resolvedCharacterId, actorName: resolvedActorName ?? foundryName };
      }

      const uRes = await query(
        `SELECT id FROM users
         WHERE LOWER(COALESCE(display_name, name)) = LOWER($1)
         LIMIT 1`,
        [foundryName],
      );
      if (uRes.rows.length) {
        return { playerId: uRes.rows[0].id, characterId: resolvedCharacterId, actorName: resolvedActorName ?? foundryName };
      }
    }
    return null;
  }

  // 3. characterId explícito (chamada humana) — valida e deriva actorName
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

  // 4. Fallback: playerId + actorName por nome (sem characterId conhecido)
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