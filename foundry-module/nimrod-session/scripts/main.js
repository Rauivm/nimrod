/**
 * scripts/main.js — v4 (actorId + origem por userId)
 *
 * Nimrod Session — Resource Log
 * Entry point do módulo Foundry VTT.
 *
 * Responsabilidades:
 *   1. Registra settings do módulo (init hook)
 *   2. Registra hooks de eventos de recursos (ready hook)
 *   3. Expõe API global window.NimrodSession para uso no console
 *   4. Botão na barra de cena para status rápido (v13/v14)
 *
 * Hooks escutados:
 *   updateActor   → ouro, XP, HP, espaços de magia (via registro RESOURCE_HANDLERS,
 *                   ver ResourceHandlers.js — main.js não conhece nenhum
 *                   recurso individualmente, apenas itera o registro)
 *   createItem    → item adquirido / poção recebida (EventDetector)
 *   deleteItem    → item consumido / removido (EventDetector)
 *   deleteCombat  → marca fim de combate (HP final dos participantes, evento snapshot)
 *
 * Controle de origem (não mais _canControl()/isGM):
 *   Cada hook do Foundry recebe o `userId` de quem originou a mudança.
 *   Todo hook compara esse userId contra `game.user.id` e só o cliente que
 *   causou a edição envia o evento — isso vale tanto para o GM quanto para
 *   PLAYERs editando suas próprias fichas, sem duplicar entre clientes
 *   conectados simultaneamente:
 *
 *     if (userId !== game.user.id) return;
 *
 * Identidade dos eventos:
 *   Todo evento enviado carrega `actorId` (Foundry actor._id), nunca
 *   `playerId`. O backend resolve playerId/characterId internamente via
 *   player_characters.foundry_actor_id (ver resolveEventIdentity no
 *   backend). O módulo Foundry não precisa mais de nenhum mapeamento
 *   manual (PlayerMap) para enviar eventos de recurso — PlayerMap
 *   permanece apenas como ferramenta de diagnóstico via console
 *   (NimrodSession.players) e não é usado por nenhum hook automático.
 */

import { SessionSync }      from './SessionSync.js';
import { EventDetector }    from './EventDetector.js';
import { PlayerMap }        from './PlayerMap.js';
import { RESOURCE_HANDLERS } from './ResourceHandlers.js';
import { PlayerHandlers }    from './PlayerHandlers.js';
import { SceneHandlers }     from './SceneHandlers.js';
import { EventType }         from './EventTypes.js';

const MODULE_ID = 'nimrod-session';

// ═══════════════════════════════════════════════════════════════════════════
// 1. SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

Hooks.once('init', () => {

  PlayerHandlers.registerSettings();

  game.settings.register(MODULE_ID, 'syncEnabled', {
    name: 'NS.Settings.SyncEnabled', hint: 'NS.Settings.SyncEnabledHint',
    scope: 'world', config: true, type: Boolean, default: true,
  });

  game.settings.register(MODULE_ID, 'nimrodUrl', {
    name: 'NS.Settings.NimrodUrl', hint: 'NS.Settings.NimrodUrlHint',
    scope: 'world', config: true, type: String, default: '',
  });

  // Substituiu nimrodToken — autenticação agora é por API Key
  game.settings.register(MODULE_ID, 'nimrodApiKey', {
    name:    'API Key do Nimrod',
    hint:    'Chave FOUNDRY_API_KEY configurada no servidor. Preenchida automaticamente pelo nimrod-bridge.',
    scope:   'world',
    config:  true,
    type:    String,
    default: '',
  });

  // Preenchido automaticamente pelo nimrod-bridge após o handshake
  game.settings.register(MODULE_ID, 'activeSessionId', {
    name:    'NS.Settings.ActiveSessionId',
    hint:    'Preenchido automaticamente após o handshake com o Foundry.',
    scope:   'world',
    config:  true,
    type:    String,
    default: '',
    onChange: (val) => {
      SessionSync.clearSentCache();
      console.log(`%cnimrod-session | Sessão ativa → ${val || '(nenhuma)'}`, 'color:#c9a84c');
      // Se acabou de receber um sessionId e os hooks ainda não foram registrados, registra
      if (val && !_hooksRegistered) _registerHooks();
      // Presença tem ciclo de vida próprio (timers de heartbeat/idle) —
      // liga ao entrar em sessão, desliga ao sair, independente do gate
      // "uma vez para sempre" usado pelos hooks de recurso/item.
      if (val) PlayerHandlers.register();
      else     PlayerHandlers.unregister();
    },
  });

  game.settings.register(MODULE_ID, 'onlyPlayerOwned', {
    name: 'NS.Settings.OnlyPlayerOwned', hint: 'NS.Settings.OnlyPlayerOwnedHint',
    scope: 'world', config: true, type: Boolean, default: true,
  });

  game.settings.register(MODULE_ID, 'trackHp', {
    name: 'NS.Settings.TrackHp', hint: 'NS.Settings.TrackHpHint',
    scope: 'world', config: true, type: Boolean, default: false,
  });

  game.settings.register(MODULE_ID, 'trackItems', {
    name: 'NS.Settings.TrackItems', hint: 'NS.Settings.TrackItemsHint',
    scope: 'world', config: true, type: Boolean, default: true,
  });

  game.settings.register(MODULE_ID, 'playerMap', {
    name: 'Player Map', scope: 'world', config: false, type: Object, default: {},
  });

  console.log('%cnimrod-session | Initialized', 'color:#c9a84c;font-weight:bold');
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. REGISTRO DE HOOKS (chamado quando sessionId fica disponível)
// ═══════════════════════════════════════════════════════════════════════════

let _hooksRegistered = false;

function _registerHooks() {
  if (_hooksRegistered) return;

  _hooksRegistered = true;
  console.log('%cnimrod-session | Registrando hooks de recursos…', 'color:#4a9a6a');

  // Cache pré-update — captura o estado do actor ANTES da mudança ser
  // aplicada (necessário porque, no hook `updateActor`, o actor recebido
  // já reflete o estado PÓS-update). Genérico: itera RESOURCE_HANDLERS e
  // chama snapshot() apenas para os recursos que `changes` de fato tocou.
  // Adicionar um novo recurso rastreável não exige tocar este bloco —
  // apenas registrar uma nova entrada em ResourceHandlers.js.
  const preUpdateCache = new Map();
  const preActorStateCache = new Map();
  const preItemUpdateCache = new Map();

  Hooks.on('preUpdateActor', (actor, changes, options, userId) => {
    if (userId !== game.user.id) return; // só quem originou a mudança guarda snapshot

    const sys = changes?.system ?? {};
    const snapshot = {};

    for (const [key, handler] of Object.entries(RESOURCE_HANDLERS)) {
      if (foundry.utils.getProperty(sys, handler.path) !== undefined) {
        snapshot[key] = handler.snapshot(actor);
      }
    }

    if (
      foundry.utils.getProperty(sys, 'attributes.hp') !== undefined ||
      foundry.utils.getProperty(sys, 'attributes.death') !== undefined
    ) {
      preActorStateCache.set(actor.id, {
        hp: Number(actor.system?.attributes?.hp?.value ?? 0),
        deathSuccess: Number(actor.system?.attributes?.death?.success ?? actor.system?.attributes?.death?.successes ?? 0),
        deathFailure: Number(actor.system?.attributes?.death?.failure ?? actor.system?.attributes?.death?.failures ?? 0),
      });
      if (preActorStateCache.size > 100) {
        preActorStateCache.delete(preActorStateCache.keys().next().value);
      }
    }

    if (Object.keys(snapshot).length === 0) return;

    preUpdateCache.set(actor.id, snapshot);
    if (preUpdateCache.size > 100) {
      preUpdateCache.delete(preUpdateCache.keys().next().value);
    }
  });

  Hooks.on('updateActor', async (actor, changes, options, userId) => {
    if (userId !== game.user.id) return; // só quem originou a mudança envia

    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;
    if (!SessionSync.activeSessionId) return;
    if (!actor.id) return;

    const trackHp = game.settings.get(MODULE_ID, 'trackHp');
    const pre = preUpdateCache.get(actor.id) ?? {};
    preUpdateCache.delete(actor.id);

    // Itera o registro de recursos — cada handler decide, com base em seu
    // próprio snapshot pré-update, se algo de fato mudou e monta o(s)
    // evento(s) completos (delta/before/after/description já resolvidos).
    const events = [];
    for (const [key, handler] of Object.entries(RESOURCE_HANDLERS)) {
      if (key === 'hp' && !trackHp) continue; // respeita a setting trackHp
      events.push(...handler.complete(actor, changes, pre[key]));
    }

    for (const ev of events) {
      // Defensivo: handlers já filtram delta=0 internamente (exceto
      // snapshots explícitos, que não passam por este hook — ver
      // deleteCombat abaixo). Mantido como rede de segurança.
      if (ev.delta === 0 && !ev.deltaMeta?.snapshot) continue;

      await SessionSync.sendEvent({
        actorId: actor.id,
        actorName: actor.name,
        ...ev,
        foundryEventId: `${game.world.id}-${actor.id}-${ev.resourceType}-${Date.now()}`,
      });
    }

    const preState = preActorStateCache.get(actor.id);
    preActorStateCache.delete(actor.id);

    if (preState) {
      const afterHp = Number(actor.system?.attributes?.hp?.value ?? 0);
      const afterDeathSuccess = Number(actor.system?.attributes?.death?.success ?? actor.system?.attributes?.death?.successes ?? 0);
      const afterDeathFailure = Number(actor.system?.attributes?.death?.failure ?? actor.system?.attributes?.death?.failures ?? 0);
      const statePayload = {
        hp_before: preState.hp,
        hp_after: afterHp,
        death_success_before: preState.deathSuccess,
        death_success_after: afterDeathSuccess,
        death_failure_before: preState.deathFailure,
        death_failure_after: afterDeathFailure,
      };

      const structuralEvents = [];
      if (preState.hp > 0 && afterHp <= 0) {
        structuralEvents.push(EventType.UNCONSCIOUS);
      }
      if (preState.hp <= 0 && afterHp > 0) {
        structuralEvents.push(EventType.REVIVED);
      }
      if (afterDeathSuccess > preState.deathSuccess) {
        structuralEvents.push(EventType.DEATH_SAVE_SUCCESS);
      }
      if (afterDeathFailure > preState.deathFailure) {
        structuralEvents.push(EventType.DEATH_SAVE_FAILURE);
      }
      if (preState.deathFailure < 3 && afterDeathFailure >= 3) {
        structuralEvents.push(EventType.DEAD);
      }

      for (const eventType of structuralEvents) {
        await SessionSync.sendSessionEvent({
          eventType,
          actorId: actor.id,
          actorName: actor.name,
          payload: statePayload,
          foundryEventId: `${game.world.id}-${actor.id}-${eventType}-${Date.now()}`,
        });
      }
    }
  });

  Hooks.on('preUpdateItem', (item, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (!game.settings.get(MODULE_ID, 'trackItems')) return;

    const sys = changes?.system ?? {};
    const touched =
      foundry.utils.getProperty(sys, 'quantity') !== undefined ||
      foundry.utils.getProperty(sys, 'uses.value') !== undefined ||
      foundry.utils.getProperty(sys, 'equipped') !== undefined ||
      foundry.utils.getProperty(sys, 'attuned') !== undefined;
    if (!touched) return;

    const actor = item.parent;
    if (!(actor instanceof Actor) || !actor.id) return;

    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;
    if (!SessionSync.activeSessionId) return;

    const snapshot = EventDetector.snapshotItem(item);
    if (!snapshot) return;

    preItemUpdateCache.set(item.uuid ?? item.id, snapshot);
    if (preItemUpdateCache.size > 100) {
      preItemUpdateCache.delete(preItemUpdateCache.keys().next().value);
    }
  });

  Hooks.on('updateItem', async (item, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (!game.settings.get(MODULE_ID, 'trackItems')) return;

    const actor = item.parent;
    if (!(actor instanceof Actor) || !actor.id) return;

    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;
    if (!SessionSync.activeSessionId) return;

    const cacheKey = item.uuid ?? item.id;
    const pre = preItemUpdateCache.get(cacheKey);
    preItemUpdateCache.delete(cacheKey);

    const { resourceEvents, sessionEvents } = EventDetector.fromItemUpdate(actor, item, pre);

    for (const ev of resourceEvents) {
      if (ev.delta === 0) continue;
      await SessionSync.sendEvent({
        actorId: actor.id,
        actorName: actor.name,
        ...ev,
        foundryEventId: `${game.world.id}-updateItem-${item.id}-${ev.deltaMeta?.change_type ?? 'change'}-${Date.now()}`,
      });
    }

    for (const ev of sessionEvents) {
      await SessionSync.sendSessionEvent({
        actorId: actor.id,
        actorName: actor.name,
        ...ev,
        foundryEventId: `${game.world.id}-updateItem-${item.id}-${ev.eventType}-${Date.now()}`,
      });
    }
  });

  console.log("register createItem");
  Hooks.on('createItem', async (item, options, userId) => {
    if (userId !== game.user.id) return; // só quem originou a mudança envia
    if (!game.settings.get(MODULE_ID, 'trackItems')) return;
    const actor = item.parent;
    if (!(actor instanceof Actor) || !actor.id) return;
    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;
    if (!SessionSync.activeSessionId) return;
    const ev = EventDetector.fromItemCreate(actor, item);
    if (!ev) return;
    await SessionSync.sendEvent({
      actorId: actor.id, actorName: actor.name, ...ev,
      foundryEventId: `${game.world.id}-createItem-${item.id}-${Date.now()}`,
    });
  });
  console.log("register deleteItem");
  Hooks.on('deleteItem', async (item, options, userId) => {
    if (userId !== game.user.id) return; // só quem originou a mudança envia
    if (!game.settings.get(MODULE_ID, 'trackItems')) return;

    const actor = item.parent;
    if (!(actor instanceof Actor) || !actor.id) return;

    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;

    if (!SessionSync.activeSessionId) return;

    const ev = EventDetector.fromItemDelete(actor, item);
    if (!ev) return;

    await SessionSync.sendEvent({
      actorId: actor.id,
      actorName: actor.name,
      ...ev,
      foundryEventId: `${game.world.id}-deleteItem-${item.id}-${Date.now()}`,
    });
  });

  async function sendCombatEvent(combat, eventType, { combatant = null, changes = null } = {}) {
    if (!SessionSync.activeSessionId) return;

    const actor = combatant?.actor ?? null;
    await SessionSync.sendSessionEvent({
      eventType,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? combatant?.name ?? null,
      payload: {
        combat_id: combat?.id ?? combatant?.parent?.id ?? null,
        scene_id: combat?.scene?.id ?? canvas?.scene?.id ?? null,
        round: combat?.round ?? null,
        turn: combat?.turn ?? null,
        combatant_id: combatant?.id ?? null,
        token_id: combatant?.tokenId ?? combatant?.token?.id ?? null,
        defeated: combatant?.defeated ?? null,
        actor_type: actor?.type ?? null,
        has_player_owner: actor?.hasPlayerOwner ?? false,
        changes: changes ?? null,
      },
      foundryEventId: `${game.world.id}-${eventType}-${combat?.id ?? combatant?.parent?.id ?? 'combat'}-${combatant?.id ?? 'table'}-${Date.now()}`,
    });
  }

  Hooks.on('createCombat', async (combat, options, userId) => {
    if (userId !== game.user.id) return;
    await sendCombatEvent(combat, EventType.COMBAT_STARTED);
  });

  Hooks.on('updateCombat', async (combat, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (changes?.round !== undefined) {
      await sendCombatEvent(combat, EventType.COMBAT_ROUND_CHANGED, { changes: { round: changes.round } });
    }
    if (changes?.turn !== undefined) {
      await sendCombatEvent(combat, EventType.COMBAT_TURN_CHANGED, { changes: { turn: changes.turn } });
    }
  });

  Hooks.on('createCombatant', async (combatant, options, userId) => {
    if (userId !== game.user.id) return;
    await sendCombatEvent(combatant.parent, EventType.COMBAT_ENTERED, { combatant });
  });

  Hooks.on('deleteCombatant', async (combatant, options, userId) => {
    if (userId !== game.user.id) return;
    await sendCombatEvent(combatant.parent, EventType.COMBAT_EXITED, { combatant });
  });

  Hooks.on('updateCombatant', async (combatant, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (changes?.defeated !== true) return;
    await sendCombatEvent(combatant.parent, EventType.COMBAT_DEFEATED, {
      combatant,
      changes: { defeated: true },
    });
  });

  Hooks.on('deleteCombat', async (combat, options, userId) => {
    if (userId !== game.user.id) return; // só quem originou o encerramento envia
    if (!SessionSync.activeSessionId) return;

    await sendCombatEvent(combat, EventType.COMBAT_ENDED);

    if (!game.settings.get(MODULE_ID, 'trackHp'))  return;
    for (const combatant of (combat.combatants?.contents ?? [])) {
      const actor = combatant.actor;
      if (!actor?.id || actor.type !== 'character' || !actor.hasPlayerOwner) continue;
      const hp = actor.system?.attributes?.hp ?? {};
      // Convenção: este é um evento SNAPSHOT (estado pontual de HP ao fim
      // do combate, não uma variação) — por isso delta=0 é intencional e
      // aceito pelo backend apenas quando deltaMeta.snapshot === true. Todo
      // outro evento com delta=0 é descartado (ver updateActor abaixo, que
      // pula eventos com `ev.delta === 0`).
      await SessionSync.sendEvent({
        actorId: actor.id, actorName: actor.name,
        resourceType: 'hp', delta: 0,
        valueBefore: null, valueAfter: Number(hp.value ?? 0),
        deltaMeta: { snapshot: true, max_hp: Number(hp.max ?? 0), combat_id: combat.id },
        description: `Fim de combate — ${actor.name}: ${hp.value}/${hp.max} HP`,
        foundryEventId: `${game.world.id}-combatEnd-${combat.id}-${actor.id}`,
      });
    }
  });

  // Cena/mapa/tokens — ver SceneHandlers.js para o que é e não é rastreado
  SceneHandlers.register();

  // Botões na barra de cena
  Hooks.on('getSceneControlButtons', (controls) => {
    controls[MODULE_ID] = {
      name: MODULE_ID, title: 'Nimrod Session',
      icon: 'fa-solid fa-scroll', order: 98,
      tools: {
        status: {
          name: 'status', title: 'Status da Sessão',
          icon: 'fa-solid fa-circle-info', button: true,
          onClick: () => {
            const s = SessionSync.status();
            ui.notifications.info(
              `Nimrod | ${s.enabled ? '✅' : '⏹'} | Sessão: ${s.activeSessionId?.slice(0,8) || 'nenhuma'} | ${s.sentCount} eventos`,
            );
          },
        },
        ping: {
          name: 'ping', title: 'Testar Conexão',
          icon: 'fa-solid fa-satellite-dish', button: true,
          onClick: async () => {
            const ok = await SessionSync.ping();
            ok ? ui.notifications.info('Nimrod | ✅ Conexão OK')
               : ui.notifications.error('Nimrod | ❌ Falhou — verifique URL e API Key.');
          },
        },
        clearCache: {
          name: 'clearCache', title: 'Limpar Cache de Eventos',
          icon: 'fa-solid fa-trash-can', button: true,
          onClick: () => { SessionSync.clearSentCache(); ui.notifications.info('Nimrod | Cache limpo.'); },
        },
      },
    };
  });

  console.log('%cnimrod-session | Hooks registrados ✓', 'color:#4a9a6a;font-weight:bold');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. READY
// ═══════════════════════════════════════════════════════════════════════════

Hooks.once('ready', () => {
  _exposeApi();

  // Hooks são registrados para QUALQUER usuário (GM ou PLAYER) — o filtro
  // de origem acontece dentro de cada handler via comparação de userId
  // (ver comentário no topo do arquivo).

  // Se o sessionId já está disponível (reload com sessão em andamento), registra imediatamente
  if (SessionSync.activeSessionId) {
    _registerHooks();
    PlayerHandlers.register();
  } else {
    console.log('nimrod-session | Aguardando handshake para registrar hooks…');
  }

  _logStatus();
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. API GLOBAL
// ═══════════════════════════════════════════════════════════════════════════

function _exposeApi() {
  window.NimrodSession = {
    sync:     SessionSync,
    players:  PlayerMap, // diagnóstico via console apenas — não usado por hooks
    detector: EventDetector,
    presence: PlayerHandlers,
    scene:    SceneHandlers,

    /**
     * Envia um evento manualmente via console do Foundry.
     * Resolve actorId pelo nome do ator no mundo atual — não depende de
     * PlayerMap nem de nenhum mapeamento manual.
     *
     * Exemplo:
     *   await NimrodSession.log("Thorin", "gold", -50, { description: "Comprou poção" })
     */
    async log(actorName, type, delta, opts = {}) {
      const actor = game.actors?.find(a => a.name === actorName);
      if (!actor) {
        console.error(`nimrod-session | log: ator "${actorName}" não encontrado no mundo.`);
        return null;
      }
      return SessionSync.sendEvent({
        actorId: actor.id, actorName, resourceType: type, delta,
        description: opts.description ?? null,
        deltaMeta:   opts.deltaMeta   ?? {},
        valueBefore: opts.valueBefore ?? null,
        valueAfter:  opts.valueAfter  ?? null,
      });
    },
  };
  console.log('%cnimrod-session | window.NimrodSession disponível', 'color:#c9a84c');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function _logStatus() {
  console.group('%cnimrod-session | Status na inicialização', 'color:#c9a84c;font-weight:bold');
  console.log('Sync:              ', SessionSync.enabled);
  console.log('URL:               ', SessionSync.baseUrl || '(não configurada)');
  console.log('API Key:           ', SessionSync.apiKey ? '✅' : '⚠️ ausente');
  console.log('Sessão ativa:      ', SessionSync.activeSessionId || '(aguardando handshake)');
  console.log('Hooks registrados: ', _hooksRegistered ? '✅' : '⏳ aguardando');
  console.groupEnd();
}
