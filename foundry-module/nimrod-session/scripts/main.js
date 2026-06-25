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
 * Guarda de GM:
 *   Todos os hooks verificam game.user.isGM antes de executar qualquer
 *   lógica. Só o GM (que roda o servidor Foundry) envia eventos — evita
 *   duplicatas em sessões com múltiplos clientes.
 */

import { SessionSync }   from "./SessionSync.js";
import { EventDetector } from "./EventDetector.js";
import { PlayerMap }     from "./PlayerMap.js";

const MODULE_ID = "nimrod-session";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

Hooks.once("init", () => {

  // Sync habilitado globalmente
  game.settings.register(MODULE_ID, "syncEnabled", {
    name:    "NS.Settings.SyncEnabled",
    hint:    "NS.Settings.SyncEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // URL base do Nimrod (ex: https://nimrod.meusite.com)
  game.settings.register(MODULE_ID, "nimrodUrl", {
    name:    "NS.Settings.NimrodUrl",
    hint:    "NS.Settings.NimrodUrlHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
  });

  // Token JWT do GM principal (copiado do painel Nimrod)
  game.settings.register(MODULE_ID, "nimrodToken", {
    name:    "NS.Settings.NimrodToken",
    hint:    "NS.Settings.NimrodTokenHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
  });

  // ID da sessão ativa no Nimrod (copiado do painel ao abrir a sessão)
  game.settings.register(MODULE_ID, "activeSessionId", {
    name:    "NS.Settings.ActiveSessionId",
    hint:    "NS.Settings.ActiveSessionIdHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
    onChange: () => {
      // Limpa cache de eventos ao trocar de sessão
      SessionSync.clearSentCache();
      console.log(
        `%cnimrod-session | Sessão ativa alterada → ${SessionSync.activeSessionId || "(nenhuma)"}`,
        "color:#c9a84c",
      );
    },
  });

  // Filtrar apenas PCs com dono (ignora NPCs e tokens temporários)
  game.settings.register(MODULE_ID, "onlyPlayerOwned", {
    name:    "NS.Settings.OnlyPlayerOwned",
    hint:    "NS.Settings.OnlyPlayerOwnedHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // Capturar eventos de HP (pode ser verboso em combate)
  game.settings.register(MODULE_ID, "trackHp", {
    name:    "NS.Settings.TrackHp",
    hint:    "NS.Settings.TrackHpHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,  // desativado por padrão — muito ruidoso em combate
  });

  // Capturar eventos de itens (createItem / deleteItem)
  game.settings.register(MODULE_ID, "trackItems", {
    name:    "NS.Settings.TrackItems",
    hint:    "NS.Settings.TrackItemsHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // Mapeamento Foundry userId → Nimrod UUID (editado pelo GM via console)
  game.settings.register(MODULE_ID, "playerMap", {
    name:    "Player Map",
    scope:   "world",
    config:  false,   // oculto da UI — editado via NimrodSession.players
    type:    Object,
    default: {},
  });

  console.log(`%cnimrod-session | Initialized`, "color:#c9a84c;font-weight:bold");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. HOOKS DE RECURSOS
// ═══════════════════════════════════════════════════════════════════════════════

Hooks.once("ready", () => {

  // ── Guarda: apenas o GM envia eventos ──────────────────────────────────────
  if (!game.user.isGM) {
    console.log("nimrod-session | Usuário não é GM — hooks de sync não registrados.");
    _exposeApi();
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hook: updateActor
  // Assinatura v13/v14: (actor, changes, options, userId)
  //
  // IMPORTANTE: No Foundry v13+, o `actor` recebido no hook já reflete o
  // estado PÓS-update. Para calcular deltas de ouro corretamente, capturamos
  // o estado PRÉ-update via preUpdateActor.
  // ─────────────────────────────────────────────────────────────────────────────

  // Cache pré-update para calcular deltas de moeda corretamente
  const preUpdateCache = new Map(); // actorId → { currency, hp }

  Hooks.on("preUpdateActor", (actor, changes, _options, _userId) => {
    // Só cacheia se há mudança relevante
    const hasCurrency = changes?.system?.currency;
    const hasHp       = changes?.system?.attributes?.hp;
    if (!hasCurrency && !hasHp) return;

    preUpdateCache.set(actor.id, {
      currency: hasCurrency ? { ...actor.system?.currency } : null,
      hp:       hasHp       ? { ...actor.system?.attributes?.hp } : null,
    });

    // Limpa entradas antigas (evita memory leak em sessões longas)
    if (preUpdateCache.size > 100) {
      const firstKey = preUpdateCache.keys().next().value;
      preUpdateCache.delete(firstKey);
    }
  });

  Hooks.on("updateActor", async (actor, changes, _options, _userId) => {
    // Só PCs com dono (se configurado)
    const onlyOwned = game.settings.get(MODULE_ID, "onlyPlayerOwned");
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== "character")) return;

    const trackHp    = game.settings.get(MODULE_ID, "trackHp");
    const sessionId  = SessionSync.activeSessionId;
    if (!sessionId) return; // sem sessão ativa, ignora silenciosamente

    // Recupera playerId do mapeamento
    const playerId = PlayerMap.getNimrodId(actor);
    if (!playerId) {
      // Sem mapeamento — loga uma vez a cada 60s para não poluir o console
      _warnOnceMissingMap(actor);
      return;
    }

    // Detecta eventos a partir das mudanças
    let events = EventDetector.fromActorUpdate(actor, changes);

    // Remove HP se desativado nas configurações
    if (!trackHp) {
      events = events.filter(e => e.resourceType !== "hp");
    }

    // Injeta valueBefore/valueAfter de moedas via cache pré-update
    const pre = preUpdateCache.get(actor.id);
    if (pre) {
      for (const event of events) {
        if (event.resourceType === "gold" && pre.currency) {
          // Recalcula delta com valores pré-update precisos
          const RATES = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };
          const goldBefore = Object.entries(pre.currency).reduce(
            (sum, [c, v]) => sum + Number(v) * (RATES[c] ?? 0), 0,
          );
          const goldAfter = Object.entries(actor.system?.currency ?? {}).reduce(
            (sum, [c, v]) => sum + Number(v) * (RATES[c] ?? 0), 0,
          );
          event.delta       = Math.round((goldAfter - goldBefore) * 100) / 100;
          event.valueBefore = Math.round(goldBefore * 100) / 100;
          event.valueAfter  = Math.round(goldAfter  * 100) / 100;
          event.description = event.delta < 0
            ? `Gastou ${Math.abs(event.delta)} po (${actor.name})`
            : `Recebeu ${event.delta} po (${actor.name})`;
        }
        if (event.resourceType === "hp" && pre.hp) {
          event.valueBefore = Number(pre.hp.value ?? 0);
        }
      }
      preUpdateCache.delete(actor.id);
    }

    // Envia cada evento detectado
    for (const ev of events) {
      if (ev.delta === 0) continue; // delta zero após recalcular → ignora

      await SessionSync.sendEvent({
        playerId,
        actorName:    actor.name,
        resourceType: ev.resourceType,
        delta:        ev.delta,
        valueBefore:  ev.valueBefore,
        valueAfter:   ev.valueAfter,
        deltaMeta:    ev.deltaMeta,
        description:  ev.description,
        // foundryEventId único por evento + ator + timestamp
        foundryEventId: `${game.world.id}-${actor.id}-${ev.resourceType}-${Date.now()}`,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Hook: createItem — item adquirido
  // ─────────────────────────────────────────────────────────────────────────────

  Hooks.on("createItem", async (item, _options, _userId) => {
    if (!game.settings.get(MODULE_ID, "trackItems")) return;

    const actor = item.parent;
    if (!(actor instanceof Actor)) return;

    const onlyOwned = game.settings.get(MODULE_ID, "onlyPlayerOwned");
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== "character")) return;

    if (!SessionSync.activeSessionId) return;

    const playerId = PlayerMap.getNimrodId(actor);
    if (!playerId) return;

    const event = EventDetector.fromItemCreate(actor, item);
    if (!event) return;

    await SessionSync.sendEvent({
      playerId,
      actorName:      actor.name,
      ...event,
      foundryEventId: `${game.world.id}-createItem-${item.id}-${Date.now()}`,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Hook: deleteItem — item consumido/removido
  // ─────────────────────────────────────────────────────────────────────────────

  Hooks.on("deleteItem", async (item, _options, _userId) => {
    if (!game.settings.get(MODULE_ID, "trackItems")) return;

    const actor = item.parent;
    if (!(actor instanceof Actor)) return;

    const onlyOwned = game.settings.get(MODULE_ID, "onlyPlayerOwned");
    if (onlyOwned && (!actor.hasPlayerOwner || actor.type !== "character")) return;

    if (!SessionSync.activeSessionId) return;

    const playerId = PlayerMap.getNimrodId(actor);
    if (!playerId) return;

    const event = EventDetector.fromItemDelete(actor, item);
    if (!event) return;

    await SessionSync.sendEvent({
      playerId,
      actorName:      actor.name,
      ...event,
      foundryEventId: `${game.world.id}-deleteItem-${item.id}-${Date.now()}`,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Hook: deleteCombat — fim de combate
  // Snapshot de HP de todos os combatentes ao encerrar o encontro
  // ─────────────────────────────────────────────────────────────────────────────

  Hooks.on("deleteCombat", async (combat, _options, _userId) => {
    if (!game.settings.get(MODULE_ID, "trackHp"))  return;
    if (!SessionSync.activeSessionId)               return;

    // Só loga o HP final dos combatentes com dono
    const combatants = combat.combatants?.contents ?? [];

    for (const combatant of combatants) {
      const actor = combatant.actor;
      if (!actor || actor.type !== "character" || !actor.hasPlayerOwner) continue;

      const playerId = PlayerMap.getNimrodId(actor);
      if (!playerId) continue;

      const hp    = actor.system?.attributes?.hp ?? {};
      const value = Number(hp.value ?? 0);
      const max   = Number(hp.max   ?? 0);

      await SessionSync.sendEvent({
        playerId,
        actorName:      actor.name,
        resourceType:   "hp",
        delta:          0, // snapshot, não delta — marcado via deltaMeta
        valueBefore:    null,
        valueAfter:     value,
        deltaMeta:      { snapshot: true, max_hp: max, combat_id: combat.id },
        description:    `Fim de combate — ${actor.name}: ${value}/${max} HP`,
        foundryEventId: `${game.world.id}-combatEnd-${combat.id}-${actor.id}`,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Botão na barra de cena (v13/v14: controls é um OBJETO)
  // ─────────────────────────────────────────────────────────────────────────────

  Hooks.on("getSceneControlButtons", (controls) => {
    controls[MODULE_ID] = {
      name:  MODULE_ID,
      title: "Nimrod Session",
      icon:  "fa-solid fa-scroll",
      order: 98,
      tools: {
        status: {
          name:    "status",
          title:   "Status da Sessão",
          icon:    "fa-solid fa-circle-info",
          button:  true,
          onClick: () => {
            const s = SessionSync.status();
            const sessionLabel = s.activeSessionId
              ? `Sessão: ${s.activeSessionId.slice(0, 8)}…`
              : "Nenhuma sessão ativa";
            const msg = `Nimrod Session | ${s.enabled ? "✅ Ativo" : "⏹ Inativo"} | ${sessionLabel} | ${s.sentCount} eventos enviados`;
            ui.notifications.info(msg);
          },
        },
        ping: {
          name:    "ping",
          title:   "Testar Conexão Nimrod",
          icon:    "fa-solid fa-satellite-dish",
          button:  true,
          onClick: async () => {
            ui.notifications.info("nimrod-session | Testando conexão…");
            const ok = await SessionSync.ping();
            if (ok) ui.notifications.info("nimrod-session | ✅ Conexão OK");
            else    ui.notifications.error("nimrod-session | ❌ Conexão falhou — verifique URL e token nas configurações.");
          },
        },
        clearCache: {
          name:    "clearCache",
          title:   "Limpar Cache de Eventos",
          icon:    "fa-solid fa-trash-can",
          button:  true,
          onClick: () => {
            SessionSync.clearSentCache();
            ui.notifications.info("nimrod-session | Cache de eventos limpo.");
          },
        },
      },
    };
  });

  console.log(`%cnimrod-session | Hooks registrados ✓`, "color:#4a9a6a;font-weight:bold");
  _exposeApi();
  _logStartupStatus();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. API GLOBAL
// ═══════════════════════════════════════════════════════════════════════════════

function _exposeApi() {
  window.NimrodSession = {
    /** Utilitários de sincronização HTTP */
    sync: SessionSync,

    /** Gerenciamento do mapa Foundry userId → Nimrod UUID */
    players: PlayerMap,

    /** Detector de eventos (útil para debug) */
    detector: EventDetector,

    /**
     * Envia um evento manualmente via console do Foundry.
     * Útil para registrar eventos que o módulo não captura automaticamente.
     *
     * Exemplo:
     *   await NimrodSession.log("Thorin", "gold", -50, { description: "Comprou poção" })
     *
     * @param {string} actorName   - Nome do personagem
     * @param {string} type        - Tipo: 'gold'|'xp'|'potion'|'spell_slot'|'item'|'hp'|'custom'
     * @param {number} delta       - Valor (+ ganho / − gasto)
     * @param {object} [opts]      - { description, deltaMeta, valueBefore, valueAfter, playerId }
     */
    async log(actorName, type, delta, opts = {}) {
      // Tenta resolver o playerId pelo nome do ator se não foi fornecido
      let playerId = opts.playerId;
      if (!playerId) {
        const actor = game.actors.find(a => a.name === actorName);
        if (actor) playerId = PlayerMap.getNimrodId(actor);
      }
      if (!playerId) {
        console.error(`nimrod-session | log: não foi possível resolver playerId para "${actorName}". Forneça opts.playerId.`);
        return null;
      }
      return SessionSync.sendEvent({
        playerId,
        actorName,
        resourceType: type,
        delta,
        description:  opts.description ?? null,
        deltaMeta:    opts.deltaMeta   ?? {},
        valueBefore:  opts.valueBefore ?? null,
        valueAfter:   opts.valueAfter  ?? null,
      });
    },
  };

  console.log("%cnimrod-session | API disponível → window.NimrodSession", "color:#c9a84c");
  console.log([
    "  NimrodSession.sync.status()           → status atual",
    "  NimrodSession.sync.ping()             → testar conexão",
    "  NimrodSession.players.autoDiscover()  → mapear jogadores automaticamente",
    "  NimrodSession.players.list()          → ver mapeamento atual",
    "  NimrodSession.log(nome, tipo, delta)  → registrar evento manual",
  ].join("\n"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. HELPERS INTERNOS
// ═══════════════════════════════════════════════════════════════════════════════

/** Evita spam de aviso no console para atores sem mapeamento. */
const _warnedActors = new Set();
const _warnCooldowns = new Map();

function _warnOnceMissingMap(actor) {
  const now = Date.now();
  const last = _warnCooldowns.get(actor.id) ?? 0;
  if (now - last < 60_000) return; // 1 aviso por minuto por ator
  _warnCooldowns.set(actor.id, now);
  console.warn(
    `nimrod-session | Ator "${actor.name}" (${actor.id}) não tem mapeamento no PlayerMap.`,
    "Use NimrodSession.players.autoDiscover() ou NimrodSession.players.set(foundryUserId, nimrodId).",
  );
}

function _logStartupStatus() {
  const sessionId = SessionSync.activeSessionId;
  const enabled   = SessionSync.enabled;
  const url       = SessionSync.baseUrl;

  console.group("%cnimrod-session | Status na inicialização", "color:#c9a84c;font-weight:bold");
  console.log("Sync ativo:   ", enabled);
  console.log("URL Nimrod:   ", url || "(não configurada)");
  console.log("Sessão ativa: ", sessionId || "(nenhuma — configure em Module Settings)");
  console.log("PlayerMap:    ", Object.keys(PlayerMap.getAll()).length, "jogadores mapeados");
  console.groupEnd();

  if (enabled && !sessionId) {
    ui.notifications.warn(
      "nimrod-session | Nenhuma sessão ativa. Configure o ID da sessão em Configurações do Módulo.",
    );
  }
  if (enabled && !url) {
    ui.notifications.warn(
      "nimrod-session | URL do Nimrod não configurada. Configure em Configurações do Módulo.",
    );
  }
}
