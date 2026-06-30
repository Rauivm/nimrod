/**
 * scripts/main.js
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
 *   updateActor   → ouro, XP, HP, espaços de magia
 *   createItem    → item adquirido / poção recebida
 *   deleteItem    → item consumido / removido
 *   deleteCombat  → marca fim de combate (HP final dos participantes)
 *
 * Guarda de acesso:
 *   Todos os hooks verificam _canControl() antes de executar qualquer
 *   lógica. Só o responsável pela sessão envia eventos — evita
 *   duplicatas em sessões com múltiplos clientes.
 *
 *   _canControl() retorna true se:
 *     - game.user.isGM (role GM ou GM_PRINCIPAL no Foundry, que normalmente
 *       corresponde a GM/GM_PRINCIPAL no Nimrod), OU
 *     - o usuário autenticado no Nimrod é narrador da sessão ativa
 *       (verificado via GET /api/sessions/:id e comparando narrator_ids)
 */

/**
 * scripts/main.js — v3 (handshake architecture)
 *
 * Nimrod Session — Resource Log
 *
 * Mudanças v3:
 *   - Controle de acesso baseado em game.user.isGM + sessionId disponível
 *   - Não depende mais de JWT de lançamento ou sessionStorage
 *   - SessionSync usa X-Nimrod-Key em vez de JWT
 *   - Aguarda activeSessionId ficar disponível (propagado pelo nimrod-bridge)
 *   - Settings: nimrodApiKey substituiu nimrodToken
 */

import { SessionSync }   from './SessionSync.js';
import { EventDetector } from './EventDetector.js';
import { PlayerMap }     from './PlayerMap.js';

const MODULE_ID = 'nimrod-session';

// ═══════════════════════════════════════════════════════════════════════════
// 1. SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

Hooks.once('init', () => {

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
// 2. CONTROLE DE ACESSO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Retorna true se este cliente deve enviar eventos.
 * Apenas o GM do Foundry envia — evita duplicatas quando múltiplos
 * clientes estão no mesmo mundo.
 */
function _canControl() {
  return game.user.isGM;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. REGISTRO DE HOOKS (chamado quando sessionId fica disponível)
// ═══════════════════════════════════════════════════════════════════════════

let _hooksRegistered = false;

function _registerHooks() {
  console.log("nimrod-session: REGISTER HOOKS");
  if (_hooksRegistered) return;
  //  if (!_canControl())   return;

  _hooksRegistered = true;
  console.log('%cnimrod-session | Registrando hooks de recursos…', 'color:#4a9a6a');

  // Cache pré-update para deltas de moeda precisos
  const preUpdateCache = new Map();

  // Hooks.on('preUpdateActor', (actor, changes) => {
  //   const hasCurrency = changes?.system?.currency;
  //   const hasHp       = changes?.system?.attributes?.hp;
  //   if (!hasCurrency && !hasHp) return;
  //   preUpdateCache.set(actor.id, {
  //     currency: hasCurrency ? { ...actor.system?.currency } : null,
  //     hp:       hasHp       ? { ...actor.system?.attributes?.hp } : null,
  //   });
  //   if (preUpdateCache.size > 100) preUpdateCache.delete(preUpdateCache.keys().next().value);
  // });

  Hooks.on('preUpdateActor', (actor, changes, options, userId) => {

    // Apenas quem originou a alteração mantém o snapshot
    if (userId !== game.user.id) return;

    const hasCurrency = changes?.system?.currency;
    const hasHp = changes?.system?.attributes?.hp;

    if (!hasCurrency && !hasHp) return;

    preUpdateCache.set(actor.id, {
      currency: hasCurrency ? { ...actor.system?.currency } : null,
      hp: hasHp ? { ...actor.system?.attributes?.hp } : null,
    });

    if (preUpdateCache.size > 100) {
      preUpdateCache.delete(preUpdateCache.keys().next().value);
    }
  });

  console.log("register updateActor");
  Hooks.on(
    "updateActor",
    async (actor, changes, options, userId) => {

      // Apenas o cliente que originou a alteração envia
      if (userId !== game.user.id)
        return;

      console.log("UPDATE HOOK NIMROD", actor.name, changes);

      const onlyOwned = game.settings.get(MODULE_ID, "onlyPlayerOwned");

      if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== "character"))
        return;

      if (!SessionSync.activeSessionId)
        return;

      const playerId = PlayerMap.getNimrodId(actor);

      if (!playerId) {
        _warnMissing(actor);
        return;
      }

      let events = EventDetector.fromActorUpdate(actor, changes);

      console.log(events);

      if (!game.settings.get(MODULE_ID, "trackHp")) {
        events = events.filter(e => e.resourceType !== "hp");
      }

      const pre = preUpdateCache.get(actor.id);

      if (pre) {
        for (const ev of events) {

          if (ev.resourceType === "gold" && pre.currency) {

            const RATES = {
              pp: 10,
              gp: 1,
              ep: 0.5,
              sp: 0.1,
              cp: 0.01
            };

            const before = Object.entries(pre.currency)
              .reduce((s,[c,v]) => s + Number(v) * (RATES[c] ?? 0), 0);

            const after = Object.entries(actor.system?.currency ?? {})
              .reduce((s,[c,v]) => s + Number(v) * (RATES[c] ?? 0), 0);

            ev.delta = Math.round((after - before) * 100) / 100;
            ev.valueBefore = Math.round(before * 100) / 100;
            ev.valueAfter = Math.round(after * 100) / 100;

            ev.description =
              ev.delta < 0
                ? `Gastou ${Math.abs(ev.delta)} po (${actor.name})`
                : `Recebeu ${ev.delta} po (${actor.name})`;
          }

          if (ev.resourceType === "hp" && pre.hp) {
              ev.valueBefore = Number(pre.hp.value ?? 0);
              ev.valueAfter = Number(actor.system.attributes.hp.value ?? 0);
              ev.delta = ev.valueAfter - ev.valueBefore;

              ev.deltaMeta = {
                  max_hp: Number(actor.system.attributes.hp.max ?? 0)
              };

              ev.description =
                  ev.delta < 0
                      ? `${actor.name} perdeu ${Math.abs(ev.delta)} HP`
                      : `${actor.name} recuperou ${ev.delta} HP`;
          }
        }

        preUpdateCache.delete(actor.id);
      }

      for (const ev of events) {

        if (ev.delta === 0)
          continue;

        await SessionSync.sendEvent({
          playerId,
          actorName: actor.name,
          ...ev,
          foundryEventId: `${game.world.id}-${actor.id}-${ev.resourceType}-${Date.now()}`
        });
      }
    }
  );
  console.log("register createItem");
  Hooks.on('createItem', async (item) => {
    if (!game.settings.get(MODULE_ID, 'trackItems')) return;
    const actor = item.parent;
    if (!(actor instanceof Actor)) return;
    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;
    if (!SessionSync.activeSessionId) return;
    const playerId = PlayerMap.getNimrodId(actor);
    if (!playerId) return;
    const ev = EventDetector.fromItemCreate(actor, item);
    if (!ev) return;
    await SessionSync.sendEvent({
      playerId, actorName: actor.name, ...ev,
      foundryEventId: `${game.world.id}-createItem-${item.id}-${Date.now()}`,
    });
  });
  console.log("register deleteItem");
  Hooks.on('deleteItem', async (item) => {
    if (!game.settings.get(MODULE_ID, 'trackItems')) return;
    const actor = item.parent;
    if (!(actor instanceof Actor)) return;
    const onlyOwned = game.settings.get(MODULE_ID, 'onlyPlayerOwned');
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== 'character')) return;
    if (!SessionSync.activeSessionId) return;
    const playerId = PlayerMap.getNimrodId(actor);
    if (!playerId) return;
    const ev = EventDetector.fromItemDelete(actor, item);
    if (!ev) return;
    await SessionSync.sendEvent({
      playerId, actorName: actor.name, ...ev,
      foundryEventId: `${game.world.id}-deleteItem-${item.id}-${Date.now()}`,
    });
  });

  Hooks.on('deleteCombat', async (combat) => {
    if (!game.settings.get(MODULE_ID, 'trackHp'))  return;
    if (!SessionSync.activeSessionId)               return;
    for (const combatant of (combat.combatants?.contents ?? [])) {
      const actor = combatant.actor;
      if (!actor || actor.type !== 'character' || !actor.hasPlayerOwner) continue;
      const playerId = PlayerMap.getNimrodId(actor);
      if (!playerId) continue;
      const hp = actor.system?.attributes?.hp ?? {};
      await SessionSync.sendEvent({
        playerId, actorName: actor.name,
        resourceType: 'hp', delta: 0,
        valueBefore: null, valueAfter: Number(hp.value ?? 0),
        deltaMeta: { snapshot: true, max_hp: Number(hp.max ?? 0), combat_id: combat.id },
        description: `Fim de combate — ${actor.name}: ${hp.value}/${hp.max} HP`,
        foundryEventId: `${game.world.id}-combatEnd-${combat.id}-${actor.id}`,
      });
    }
  });

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
// 4. READY
// ═══════════════════════════════════════════════════════════════════════════

Hooks.once('ready', () => {
  _exposeApi();

  // if (!_canControl()) {
  //   console.log('nimrod-session | Usuário não é GM — hooks de sync não registrados.');
  //   return;
  // }

  // Se o sessionId já está disponível (reload com sessão em andamento), registra imediatamente
  if (SessionSync.activeSessionId) {
    _registerHooks();
  } else {
    console.log('nimrod-session | Aguardando handshake para registrar hooks…');
  }

  _logStatus();
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. API GLOBAL
// ═══════════════════════════════════════════════════════════════════════════

function _exposeApi() {
  window.NimrodSession = {
    sync:     SessionSync,
    players:  PlayerMap,
    detector: EventDetector,
    async log(actorName, type, delta, opts = {}) {
      let playerId = opts.playerId;
      if (!playerId) {
        const actor = game.actors?.find(a => a.name === actorName);
        if (actor) playerId = PlayerMap.getNimrodId(actor);
      }
      if (!playerId) {
        console.error(`nimrod-session | log: playerId não encontrado para "${actorName}".`);
        return null;
      }
      return SessionSync.sendEvent({
        playerId, actorName, resourceType: type, delta,
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
// 6. HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const _warnCooldowns = new Map();
function _warnMissing(actor) {
  const now = Date.now();
  if ((now - (_warnCooldowns.get(actor.id) ?? 0)) < 60_000) return;
  _warnCooldowns.set(actor.id, now);
  console.warn(`nimrod-session | "${actor.name}" sem mapeamento. Use NimrodSession.players.autoDiscover()`);
}

function _logStatus() {
  console.group('%cnimrod-session | Status na inicialização', 'color:#c9a84c;font-weight:bold');
  console.log('Sync:          ', SessionSync.enabled);
  console.log('URL:           ', SessionSync.baseUrl || '(não configurada)');
  console.log('API Key:       ', SessionSync.apiKey ? '✅' : '⚠️ ausente');
  console.log('Sessão ativa:  ', SessionSync.activeSessionId || '(aguardando handshake)');
  console.log('PlayerMap:     ', Object.keys(PlayerMap.getAll()).length, 'jogadores');
  console.groupEnd();
}