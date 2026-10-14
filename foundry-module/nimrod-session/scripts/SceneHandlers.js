/**
 * scripts/SceneHandlers.js
 *
 * Registro de cena/mapa/tokens — segunda prioridade da cobertura do
 * nimrod-session (depois de presença).
 *
 * ── O que é rastreado, e por quê esse sinal é confiável ────────────────────
 *
 *   SCENE_CHANGED
 *     Hook: updateScene(scene, changes, options, userId), quando
 *     changes.active === true. Fato de MESA (todos veem a mesma cena
 *     ativa) — não é auto-relatado; filtrado por origem (userId) como os
 *     hooks de recurso, para que só o cliente que ativou a cena envie.
 *     Em Foundry, "Scene" já É o mapa (imagem + configuração) — não existe
 *     um conceito separado de "mapa" que sobreviva a trocar de Scene
 *     mantendo alguma outra identidade. Por isso não existe um MAP_CHANGED
 *     distinto de SCENE_CHANGED aqui: seria inventar um sinal que a engine
 *     não fornece. Se no futuro isso importar (ex: duas Scenes que
 *     representam o "mesmo lugar"), precisaria de uma convenção manual
 *     (tag/flag na Scene) — não implementado por não haver pedido explícito
 *     ainda.
 *
 *   PLAYER_VIEWED_SCENE
 *     Hook: canvasReady — dispara em CADA cliente quando o canvas termina
 *     de carregar a cena para aquele cliente especificamente. Auto-
 *     relatado (mesmo modelo de PlayerHandlers): cada cliente só fala de
 *     si mesmo, sem filtro de origem necessário.
 *
 *   TOKEN_APPEARED / TOKEN_REMOVED
 *     Hooks: createToken / deleteToken (document, options, userId).
 *     Filtrado por origem — só quem criou/removeu o token envia. Cobre
 *     TODOS os tokens (PC, NPC, summon, o que for) sem tentar classificar
 *     — classificação (player/NPC/hostil/aliado/summon/companion) é
 *     escopo da categoria "Tokens ativos" (censo/contagem), ainda não
 *     implementada nesta passada.
 *
 * ── O que NÃO é rastreado aqui, e por quê ──────────────────────────────────
 *
 *   "Grupo inteiro mudou de cena" — isso é uma CORRELAÇÃO (vários
 *   PLAYER_VIEWED_SCENE próximos no tempo = o grupo todo se moveu). Por
 *   decisão de arquitetura, nimrod-session não correlaciona eventos —
 *   apenas registra fatos individuais. Um consumidor futuro (nimrod-
 *   narrative) é quem infere "o grupo mudou" a partir da sequência de
 *   PLAYER_VIEWED_SCENE já registrada.
 *
 *   "NPC mudou de cena" — NPCs não são clientes conectados, não têm um
 *   canvasReady próprio para auto-relatar. O único proxy possível seria
 *   correlacionar um TOKEN_REMOVED numa cena com um TOKEN_APPEARED do
 *   mesmo actor em outra cena, pouco depois — de novo, correlação, não
 *   fato direto. Não implementado aqui pelo mesmo motivo acima.
 */

import { SessionSync } from './SessionSync.js';

export const SceneEventType = Object.freeze({
  SCENE_CHANGED:       'SCENE_CHANGED',
  PLAYER_VIEWED_SCENE: 'PLAYER_VIEWED_SCENE',
  TOKEN_APPEARED:      'TOKEN_APPEARED',
  TOKEN_REMOVED:       'TOKEN_REMOVED',
});

export class SceneHandlers {

  static #previousSceneId   = null;
  static #previousSceneName = null;

  /**
   * Registra os hooks de cena/token. Chamado uma vez a partir de
   * main.js#_registerHooks() — mesmo gate "uma vez para sempre" dos hooks
   * de recurso (diferente de PlayerHandlers, que tem ciclo de vida próprio
   * por causa dos timers de heartbeat/idle).
   */
  static register() {
    this.#registerSceneChanged();
    this.#registerPlayerViewedScene();
    this.#registerTokenLifecycle();
    this.#reportCurrentSceneNow(); // ver comentário em #reportCurrentSceneNow
    console.log('%cnimrod-session | SceneHandlers registrado', 'color:#4a9a6a');
  }

  /**
   * Emite um PLAYER_VIEWED_SCENE imediatamente no registro, para a cena que
   * JÁ está carregada no canvas neste momento. Necessário porque
   * `canvasReady` pode ter disparado ANTES deste registro rodar (o
   * handshake ainda não tinha terminado quando o canvas terminou de
   * carregar pela primeira vez) — sem isso, a primeira visualização de
   * cena de cada cliente seria silenciosamente perdida. Mesmo padrão usado
   * em PlayerHandlers#reportConnected().
   */
  static async #reportCurrentSceneNow() {
    if (!canvas?.ready || !SessionSync.activeSessionId) return;

    const character = game.user.character ?? null;

    await SessionSync.sendSessionEvent({
      eventType:   SceneEventType.PLAYER_VIEWED_SCENE,
      actorId:     character?.id   ?? null,
      actorName:   character?.name ?? null,
      foundryName: game.user.name,
      payload: {
        scene_id:   canvas.scene?.id   ?? null,
        scene_name: canvas.scene?.name ?? null,
        initial:    true, // distingue do relato via hook canvasReady futuro
      },
    });
  }

  // ─── SCENE_CHANGED — fato de mesa, filtrado por origem ────────────────────

  static #registerSceneChanged() {
    Hooks.on('updateScene', async (scene, changes, options, userId) => {
      if (userId !== game.user.id) return; // só quem ativou a cena envia
      if (changes?.active !== true) return; // só nos interessa a ativação

      if (!SessionSync.activeSessionId) return;

      const fromId   = this.#previousSceneId;
      const fromName = this.#previousSceneName;

      this.#previousSceneId   = scene.id;
      this.#previousSceneName = scene.name;

      await SessionSync.sendSessionEvent({
        eventType: SceneEventType.SCENE_CHANGED,
        payload: {
          scene_id:            scene.id,
          scene_name:          scene.name,
          previous_scene_id:   fromId,
          previous_scene_name: fromName,
        },
        foundryEventId: `${game.world.id}-sceneChanged-${scene.id}-${Date.now()}`,
      });
    });
  }

  // ─── PLAYER_VIEWED_SCENE — auto-relatado, um por cliente ──────────────────

  static #registerPlayerViewedScene() {
    Hooks.on('canvasReady', async (canvas) => {
      if (!SessionSync.activeSessionId) return;

      const character = game.user.character ?? null;

      await SessionSync.sendSessionEvent({
        eventType:   SceneEventType.PLAYER_VIEWED_SCENE,
        actorId:     character?.id   ?? null,
        actorName:   character?.name ?? null,
        foundryName: game.user.name,
        payload: {
          scene_id:   canvas.scene?.id   ?? null,
          scene_name: canvas.scene?.name ?? null,
        },
        // Sem foundryEventId próprio: cada carregamento de canvas já é um
        // evento único o bastante (timestamp + sessionId cobrem dedupe
        // básico); SessionSync gera um id automático quando omitido.
      });
    });
  }

  // ─── TOKEN_APPEARED / TOKEN_REMOVED — filtrado por origem ─────────────────

  static #registerTokenLifecycle() {
    Hooks.on('createToken', async (tokenDoc, options, userId) => {
      if (userId !== game.user.id) return;
      if (!SessionSync.activeSessionId) return;

      const actor = tokenDoc.actor ?? null;

      await SessionSync.sendSessionEvent({
        eventType: SceneEventType.TOKEN_APPEARED,
        actorId:   actor?.id   ?? null,
        actorName: actor?.name ?? tokenDoc.name ?? null,
        payload: {
          token_id:     tokenDoc.id,
          scene_id:     tokenDoc.parent?.id ?? null,
          actor_type:   actor?.type ?? null,      // 'character' | 'npc' (dnd5e)
          disposition:  tokenDoc.disposition ?? null, // -1 hostil, 0 neutro, 1 aliado
          has_player_owner: actor?.hasPlayerOwner ?? false,
        },
        foundryEventId: `${game.world.id}-tokenAppeared-${tokenDoc.id}`,
      });
    });

    Hooks.on('deleteToken', async (tokenDoc, options, userId) => {
      if (userId !== game.user.id) return;
      if (!SessionSync.activeSessionId) return;

      const actor = tokenDoc.actor ?? null;

      await SessionSync.sendSessionEvent({
        eventType: SceneEventType.TOKEN_REMOVED,
        actorId:   actor?.id   ?? null,
        actorName: actor?.name ?? tokenDoc.name ?? null,
        payload: {
          token_id:   tokenDoc.id,
          scene_id:   tokenDoc.parent?.id ?? null,
          actor_type: actor?.type ?? null,
        },
        foundryEventId: `${game.world.id}-tokenRemoved-${tokenDoc.id}`,
      });
    });
  }
}
