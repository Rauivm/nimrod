/**
 * scripts/PlayerMap.js
 *
 * Mapeia actorId do Foundry → playerId do Nimrod. (UUID do banco).
 *
 * O mapeamento é configurado manualmente pelo GM nas configurações
 * do módulo e armazenado como JSON em game.settings (scope: "world").
 *
 * Estrutura do mapa:
 *   { [foundryActorId]: { nimrodId: string, actorName: string } }
 *
 * API pública:
 *   PlayerMap.getNimrodId(actor)   → string | null
 *   PlayerMap.getAll()             → mapa completo
 *   PlayerMap.set(foundryActorId, nimrodId, actorName)
 *   PlayerMap.remove(foundryUserId)
 *   PlayerMap.autoDiscover()       → tenta descobrir via /api/users
 */

const MODULE_ID  = "nimrod-session";
const SETTING_ID = "playerMap";

export class PlayerMap {

  // ─── Leitura ─────────────────────────────────────────────────────────────────

  /**
   * Retorna o mapa completo { foundryActorId → { nimrodId, actorName } }.
   */
  static getAll() {
    try {
      const raw = game.settings.get(MODULE_ID, SETTING_ID);
      return (typeof raw === "object" && raw !== null) ? raw : {};
    } catch { return {}; }
  }

  /**
   * Resolve o nimrodId de um actor, procurando pelo dono (usuário com ownership level 3).
   *
   * @param {Actor} actor
   * @returns {string | null}
   */
/*   static getNimrodId(actor) {
    const map = this.getAll();

    // Tenta primeiro pelo userId explícito no flag do módulo
    const flaggedUserId = actor.flags?.[MODULE_ID]?.ownerId;
    if (flaggedUserId && map[flaggedUserId]?.nimrodId) {
      return map[flaggedUserId].nimrodId;
    }

    // Itera pelos owners do ator (OWNER = 3)
    const ownership = actor.ownership ?? {};
    for (const [userId, level] of Object.entries(ownership)) {
      if (Number(level) < 3) continue;
      if (userId === "default")    continue;
      if (map[userId]?.nimrodId)   return map[userId].nimrodId;
    }

    return null;
  } */

  static getNimrodId(actor) {
    if (!actor) return null;

    const map = this.getAll();

    return map[actor.id]?.nimrodId ?? null;
  }

  /**
   * Retorna o displayName do jogador mapeado, ou o nome do ator como fallback.
   */
/*   static getDisplayName(actor) {
    const map = this.getAll();
    const ownership = actor.ownership ?? {};
    for (const [userId, level] of Object.entries(ownership)) {
      if (Number(level) < 3) continue;
      if (userId === "default") continue;
      if (map[userId]?.displayName) return map[userId].displayName;
    }
    return actor.name;
  } */

  static getDisplayName(actor) {
    if (!actor) return null;

    const map = this.getAll();

    return map[actor.id]?.actorName ?? actor.name;
  }

/**
 * Adiciona ou atualiza um mapeamento.
 *
 * @param {string} foundryActorId
 * @param {string} nimrodId
 * @param {string} actorName
 */
  static async set(foundryActorId, nimrodId, actorName) {
    if (!game.user?.isGM) {
      throw new Error("PlayerMap.set: apenas GMs podem alterar o mapeamento.");
    }

    const map = this.getAll();

    map[foundryActorId] = {
      nimrodId,
      actorName,
    };

    await game.settings.set(MODULE_ID, SETTING_ID, map);

    console.log(
      `nimrod-session | PlayerMap: ${actorName} (${foundryActorId}) → ${nimrodId}`
    );
  }

  /**
   * Remove um mapeamento.
   */
  static async remove(foundryActorId) {
    if (!game.user?.isGM) {
      throw new Error("PlayerMap.remove: apenas GMs podem alterar o mapeamento.");
    }

    const map = this.getAll();

    delete map[foundryActorId];

    await game.settings.set(MODULE_ID, SETTING_ID, map);

    console.log(
      `nimrod-session | PlayerMap: actor ${foundryActorId} removido.`
    );
  }
  // ─── Auto-descoberta ──────────────────────────────────────────────────────────

  /**
   * Tenta descobrir o mapeamento automaticamente via GET /api/users,
   * cruzando displayName do Foundry com displayName do Nimrod.
   *
   * Uso no console: await NimrodSession.players.autoDiscover()
   *
   * @returns {Promise<{mapped: number, unmapped: string[]}>}
   */
  static async autoDiscover() {
    const baseUrl = game.settings.get(MODULE_ID, "nimrodUrl")?.replace(/\/$/, "") ?? "";
    //const token   = game.settings.get(MODULE_ID, "nimrodToken") ?? "";
    const apiKey = game.settings.get(MODULE_ID, "nimrodApiKey") ?? "";

    if (!baseUrl) {
      console.warn("nimrod-session | autoDiscover: URL não configurada.");
      return { mapped: 0, unmapped: [] };
    }

    let nimrodUsers;
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: {
          "Content-Type": "application/json",
          //...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "X-Nimrod-Key": apiKey } : {})
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      nimrodUsers = await res.json();
    } catch (err) {
      console.error("nimrod-session | autoDiscover: falha ao buscar /api/users:", err.message);
      return { mapped: 0, unmapped: [] };
    }

    const map       = this.getAll();
    let   mapped    = 0;
    const unmapped  = [];

    // Para cada personagem do Foundry tenta encontrar o personagem no Nimrod
    for (const actor of game.actors) {
      if (!actor.hasPlayerOwner) continue;

      if (map[actor.id]?.nimrodId) continue;

      const match = nimrodUsers.find(user =>
          user.role === "PLAYER" &&
          user.characters?.some(character =>
              character.name?.toLowerCase() === actor.name?.toLowerCase()
          )
      );

      if (match) {
          map[actor.id] = {
              nimrodId: match.id,
              actorName: actor.name,
          };

          mapped++;

          console.log(
              `nimrod-session | autoDiscover: ${actor.name} → ${match.id}`
          );
      } else {
          unmapped.push(actor.name);
      }
    }

    if (mapped > 0) {
      await game.settings.set(MODULE_ID, SETTING_ID, map);
    }

    const msg = `autoDiscover: ${mapped} mapeados, ${unmapped.length} sem correspondência${unmapped.length ? ` (${unmapped.join(", ")})` : ""}.`;
    console.log(`%cnimrod-session | ${msg}`, "color:#4a9a6a");
    if (unmapped.length > 0) {
      ui.notifications.warn(
          `nimrod-session | ${unmapped.length} personagem(ns) sem mapeamento: ${unmapped.join(", ")}`
      );
    }

    return { mapped, unmapped };
  }

  // ─── Debug ───────────────────────────────────────────────────────────────────

  /**
   * Exibe o mapa atual no console de forma legível.
   * Uso: NimrodSession.players.list()
   */
  static list() {
    const map   = this.getAll();
    const users = game.users ?? [];
    console.group("%cnimrod-session | PlayerMap", "color:#c9a84c;font-weight:bold");
    for (const [foundryId, entry] of Object.entries(map)) {
      const fUser = users.get(foundryId);
      console.log(`  ${fUser?.name ?? foundryId} → ${entry.nimrodId} (${entry.displayName})`);
    }
    if (Object.keys(map).length === 0) console.log("  (vazio — use NimrodSession.players.autoDiscover())");
    console.groupEnd();
    return map;
  }
}