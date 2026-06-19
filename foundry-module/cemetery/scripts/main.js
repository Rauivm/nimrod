/**
 * Cemetery - Memorial dos Caídos
 * Foundry VTT Module v1.1.0
 *
 * Main entry point. Registers settings, hooks, context menu items,
 * sidebar button, and exposes the public API.
 */

import { MemorialData }          from "./MemorialData.js";
import { CemeteryApp }           from "./CemeteryApp.js";
import { RegisterDeathDialog }   from "./RegisterDeathDialog.js";
import { RestoreActorDialog }    from "./RestoreActorDialog.js";
import { EditMemorialDialog }    from "./EditMemorialDialog.js";
import { NimrodSync }            from "./NimrodSync.js";

const MODULE_ID = "cemetery";

/* ══════════════════════════════════════════════════════
   1. SETTINGS
══════════════════════════════════════════════════════ */

Hooks.once("init", () => {

  // ── Handlebars helpers (needs init scope) ─────────
  Handlebars.registerHelper("cem_or",         (a, b) => a || b);
  Handlebars.registerHelper("cem_eq",         (a, b) => a === b);
  Handlebars.registerHelper("cem_ne",         (a, b) => a !== b);
  Handlebars.registerHelper("cem_and",        (a, b) => a && b);
  Handlebars.registerHelper("cem_not",        (a)    => !a);
  Handlebars.registerHelper("cem_formatDate", (iso)  => MemorialData.formatDate(iso));
  Handlebars.registerHelper("cem_timeSince",  (iso)  => MemorialData.timeSinceDeath(iso));
  Handlebars.registerHelper("cem_defaultImg", (img)  => img || "icons/svg/mystery-man.svg");

  // ── Persistent data store ─────────────────────────
  game.settings.register(MODULE_ID, "memorialData", {
    name:    "Memorial Data",
    scope:   "world",
    config:  false,
    type:    Object,
    default: {},
  });

  // ── GM-visible settings ───────────────────────────
  game.settings.register(MODULE_ID, "memorialName", {
    name:    "CEMETERY.Settings.MemorialName",
    hint:    "CEMETERY.Settings.MemorialNameHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
    onChange: () => {
      const app = _getOpenApp();
      app?.render();
    },
  });

  game.settings.register(MODULE_ID, "allowPlayers", {
    name:    "CEMETERY.Settings.AllowPlayers",
    hint:    "CEMETERY.Settings.AllowPlayersHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "showInSidebar", {
    name:    "CEMETERY.Settings.ShowInSidebar",
    hint:    "",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => ui.controls?.render(),
  });

  // ── Nimrod Sync settings ──────────────────────────
  game.settings.register(MODULE_ID, "nimrodSyncEnabled", {
    name:    "CEMETERY.Settings.NimrodSync",
    hint:    "CEMETERY.Settings.NimrodSyncHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,  // ← ativa por padrão conforme solicitado
  });

  game.settings.register(MODULE_ID, "nimrodSyncUrl", {
    name:    "CEMETERY.Settings.NimrodSyncUrl",
    hint:    "CEMETERY.Settings.NimrodSyncUrlHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
  });

  game.settings.register(MODULE_ID, "nimrodSyncToken", {
    name:    "CEMETERY.Settings.NimrodSyncToken",
    hint:    "CEMETERY.Settings.NimrodSyncTokenHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
  });

  console.log(`%cCemetery | Initialized`, "color: #c9a84c; font-weight: bold");
});

/* ══════════════════════════════════════════════════════
   2. SIDEBAR BUTTON  — Foundry v13 API
   In v13 getSceneControlButtons receives a plain OBJECT
   (keyed by group name), not an array. Use Object.assign
   or direct property assignment to add a new group.
══════════════════════════════════════════════════════ */

Hooks.on("getSceneControlButtons", (controls) => {
  const isGM     = game.user?.isGM;
  const allowAll = game.settings.get(MODULE_ID, "allowPlayers");
  const showBtn  = game.settings.get(MODULE_ID, "showInSidebar");

  if (!showBtn || (!isGM && !allowAll)) return;

  // v13: controls is a plain object — assign a new key for our group
  controls.cemetery = {
    name:    "cemetery",
    title:   game.i18n.localize("CEMETERY.Button.Title"),
    icon:    "fas fa-landmark",
    visible: true,
    tools:   {
      open: {
        name:    "open",
        title:   game.i18n.localize("CEMETERY.Button.Title"),
        icon:    "fas fa-landmark",
        button:  true,
        onClick: () => openCemeteryApp(),
      },
    },
  };
});

/* ══════════════════════════════════════════════════════
   3. ACTOR CONTEXT MENU
   v13 hook: "getActorDirectoryEntryContext"
   The li element may be a plain HTMLElement (no jQuery).
   Actor ID lives in data-document-id.
══════════════════════════════════════════════════════ */

Hooks.on("getActorDirectoryEntryContext", (html, options) => {
  if (!game.user?.isGM) return;

  /**
   * Safely extract the actor ID from whatever li-like thing Foundry passes.
   * In v13 it tends to be a plain HTMLElement.
   */
  function _resolveActorId(li) {
    // Plain HTMLElement (v13)
    if (li instanceof HTMLElement) {
      return li.dataset.documentId
          ?? li.closest("[data-document-id]")?.dataset.documentId
          ?? null;
    }
    // jQuery wrapped (v11/v12 fallback)
    if (typeof li?.data === "function") {
      return li.data("documentId")
          ?? li[0]?.dataset?.documentId
          ?? null;
    }
    return null;
  }

  options.push({
    name:      game.i18n.localize("CEMETERY.Context.SendToMemorial"),
    icon:      '<i class="fas fa-landmark"></i>',
    condition: (li) => {
      const id = _resolveActorId(li);
      return !!(id && !MemorialData.isInMemorial(id));
    },
    callback: async (li) => {
      const actorId = _resolveActorId(li);
      if (!actorId) {
        console.error("Cemetery | Could not resolve actor ID from context menu element", li);
        return;
      }
      const actor = game.actors.get(actorId);
      if (!actor) {
        ui.notifications.error(`Cemetery | Actor ${actorId} not found`);
        return;
      }
      await sendToMemorial(actor);
    },
  });
});

/* ══════════════════════════════════════════════════════
   4. CORE FUNCTIONS
══════════════════════════════════════════════════════ */

/** Return the currently open CemeteryApp window, if any. */
function _getOpenApp() {
  return Object.values(ui.windows ?? {}).find(w => w.id === "cemetery-app") ?? null;
}

/**
 * Open (or bring to front) the main Cemetery application.
 */
function openCemeteryApp() {
  const isGM     = game.user.isGM;
  const allowAll = game.settings.get(MODULE_ID, "allowPlayers");
  if (!isGM && !allowAll) {
    ui.notifications.warn("Você não tem permissão para ver o memorial.");
    return;
  }

  const existing = _getOpenApp();
  if (existing) {
    existing.bringToTop();
    return;
  }

  const app = new CemeteryApp();
  app.render(true);
}

/**
 * Send an actor to the memorial.
 * Shows the registration dialog, persists data, and triggers Nimrod Sync.
 * @param {Actor} actor
 */
async function sendToMemorial(actor) {
  if (MemorialData.isInMemorial(actor.id)) {
    ui.notifications.warn(
      game.i18n.format("CEMETERY.Notification.AlreadyInMemorial", { name: actor.name })
    );
    return;
  }

  const extra = await RegisterDeathDialog.prompt(actor);
  if (extra === null) return; // user cancelled

  try {
    await MemorialData.registerDeath(actor, extra);
    ui.notifications.info(
      game.i18n.format("CEMETERY.Notification.Registered", { name: actor.name })
    );

    // ── Nimrod Sync: mark as isDead ────────────────
    const syncEnabled = game.settings.get(MODULE_ID, "nimrodSyncEnabled");
    if (syncEnabled) {
      const entry = MemorialData.getMemorial(actor.id);
      await NimrodSync.markDead(actor, entry).catch(err => {
        console.warn("Cemetery | Nimrod Sync failed (non-critical):", err.message);
      });
    }

    // Refresh open app window
    _getOpenApp()?.render();
  } catch (err) {
    ui.notifications.error(err.message ?? game.i18n.localize("CEMETERY.Notification.Error"));
    console.error("Cemetery |", err);
  }
}

/* ══════════════════════════════════════════════════════
   5. PUBLIC API  (window.Cemetery / window.MemorialDosCaidos)
══════════════════════════════════════════════════════ */

Hooks.once("ready", () => {

  window.Cemetery = {

    /** Register a character death programmatically (skips dialog). */
    async registerDeath(actor, data = {}) {
      const id = await MemorialData.registerDeath(actor, data);

      // Nimrod Sync
      const syncEnabled = game.settings.get(MODULE_ID, "nimrodSyncEnabled");
      if (syncEnabled) {
        const entry = MemorialData.getMemorial(actor.id);
        await NimrodSync.markDead(actor, entry).catch(err =>
          console.warn("Cemetery | Nimrod Sync failed:", err.message)
        );
      }

      _getOpenApp()?.render();
      return id;
    },

    /** Restore (resurrect) a character by actorId (skips dialog). */
    async restoreActor(actorId, data = {}) {
      await MemorialData.restoreActor(actorId, data);

      // Nimrod Sync
      const syncEnabled = game.settings.get(MODULE_ID, "nimrodSyncEnabled");
      if (syncEnabled) {
        const entry = MemorialData.getMemorial(actorId);
        await NimrodSync.markRestored(actorId, entry).catch(err =>
          console.warn("Cemetery | Nimrod Sync (restore) failed:", err.message)
        );
      }

      _getOpenApp()?.render();
    },

    /** Return all fallen entries. */
    getAllFallen() {
      return MemorialData.getAllFallen();
    },

    /** Return a single memorial entry by actorId. */
    getMemorial(actorId) {
      return MemorialData.getMemorial(actorId);
    },

    /** Open the main UI. */
    open: openCemeteryApp,

    /** Send an actor through the full dialog flow. */
    sendToMemorial,

    /** Direct access to Nimrod Sync utilities. */
    nimrod: NimrodSync,

    /** Direct access to the data manager. */
    data: MemorialData,
  };

  // Legacy alias as requested by spec
  window.MemorialDosCaidos = window.Cemetery;

  Hooks.on("createActiveEffect", async effect => {

    const actor = effect.parent;

    if (!(actor instanceof Actor)) return;

    if (!effect.statuses?.has("dead")) return;

    // Apenas PCs
    if (!actor.hasPlayerOwner) return;

    await actor.setFlag(
      "nimrod-sync",
      "isDead",
      true
    );

    // Já está no memorial
    if (MemorialData.isInMemorial(actor.id)) return;

    const extra =
      await RegisterDeathDialog.prompt(actor);

    if (extra === null) return;

    await MemorialData.registerDeath(
      actor,
      extra
    );

    ui.notifications.info(
      `${actor.name} enviado ao memorial`
    );

    _getOpenApp()?.render();
  });


  Hooks.on("deleteActiveEffect", async effect => {

    const actor = effect.parent;

    if (!(actor instanceof Actor)) return;

    if (!effect.statuses?.has("dead")) return;

    // Apenas PCs
    if (!actor.hasPlayerOwner) return;

    await actor.setFlag(
      "nimrod-sync",
      "isDead",
      false
    );

    const memorial =
      MemorialData.getMemorial(actor.id);

    if (
      memorial &&
      !memorial.restored
    ) {

      await MemorialData.restoreActor(
        actor.id,
        {}
      );

      ui.notifications.info(
        `${actor.name} ressuscitou`
      );

      _getOpenApp()?.render();
    }
  });
  console.log(`%cCemetery | API ready → window.Cemetery`, "color: #c9a84c; font-weight: bold");
  console.log(`%cCemetery | Nimrod Sync: ${game.settings.get(MODULE_ID, "nimrodSyncEnabled") ? "ATIVO" : "inativo"}`, "color: #4a9a6a");
});