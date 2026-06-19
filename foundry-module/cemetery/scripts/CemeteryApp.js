/**
 * CemeteryApp
 * The main ApplicationV2 window for the Cemetery module.
 * Displays the memorial gallery with filters, stats, and detail view.
 */

import { MemorialData }        from "./MemorialData.js";
import { RestoreActorDialog }  from "./RestoreActorDialog.js";
import { EditMemorialDialog }  from "./EditMemorialDialog.js";
import { NimrodSync }          from "./NimrodSync.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = "cemetery";

export class CemeteryApp extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options = {}) {
    super(options);

    this._search = "";
    this._typeFilter = "all";
    this._statusFilter = "all";
    this._sortMode = "date";

    // registry | gallery | detail
    this._view = "registry";

    this._detailId = null;

    this._registrySearch = "";
    this._registryType = "all";
  }

  /* ── AppV2 Config ─────────────────────────────────── */

  static DEFAULT_OPTIONS = {
    id: "cemetery-app",
    tag: "div",

    window: {
      title: "CEMETERY.ModuleName",
      resizable: true,
      minimizable: true,
    },

    position: {
      width: 860,
      height: 620,
    },

    actions: {
      viewDetail: CemeteryApp.#onViewDetail,
      backToGallery: CemeteryApp.#onBackToGallery,
      editEntry: CemeteryApp.#onEditEntry,
      restoreEntry: CemeteryApp.#onRestoreEntry,
      removeEntry: CemeteryApp.#onRemoveEntry,
      exportJSON: CemeteryApp.#onExportJSON,

      // NOVOS
      showRegistry: CemeteryApp.#onShowRegistry,
      showGallery: CemeteryApp.#onShowGallery,
      markDead: CemeteryApp.#onMarkDead,
      restoreActorRegistry: CemeteryApp.#onRestoreActorRegistry,
    },
  };

  static PARTS = {
    main: {
      template: "modules/cemetery/templates/cemetery-app.hbs",
    },
  };

  /* ── Context ──────────────────────────────────────── */

  async _prepareContext() {
    const isGM      = game.user.isGM;
    const memName   = game.settings.get(MODULE_ID, "memorialName")
                   || game.i18n.localize("CEMETERY.DefaultName");
    const stats     = MemorialData.getStats();
    const registryActors = this._getRegistryActors();

    let list = MemorialData.filter({
      search:       this._search,
      typeFilter:   this._typeFilter,
      statusFilter: this._statusFilter,
    });

    list = this._sortMode === "name"
      ? MemorialData.sortByName(list)
      : MemorialData.sortByDate(list);

    // Prepare cards
    const cards = list.map(entry => ({
      ...entry,
      isPC:       entry.type === "character",
      dateFormatted: MemorialData.formatDate(entry.deathDate),
      typeLabel:  entry.type === "character"
                    ? game.i18n.localize("CEMETERY.Card.PC")
                    : game.i18n.localize("CEMETERY.Card.NPC"),
    }));

    // Prepare detail if needed
    let detail = null;
    if (this._view === "detail" && this._detailId) {
      const e = MemorialData.getMemorial(this._detailId);
      if (e) {
        detail = {
          ...e,
          isPC:              e.type === "character",
          typeLabel:         e.type === "character"
                               ? game.i18n.localize("CEMETERY.Card.PC")
                               : game.i18n.localize("CEMETERY.Card.NPC"),
          dateFormatted:     MemorialData.formatDate(e.deathDate),
          restoredFormatted: MemorialData.formatDate(e.restoredDate),
          timeSinceDeath:    MemorialData.timeSinceDeath(e.deathDate),
        };
      } else {
        this._view   = "gallery";
        this._detailId = null;
      }
    }

    return {
      isGM,
      memorialName: memName,
      stats,

      registryActors,

      cards,
      detail,
      view:         this._view,
      search:       this._search,
      typeFilter:   this._typeFilter,
      statusFilter: this._statusFilter,
      sortMode:     this._sortMode,
      i18n: {
        search:           game.i18n.localize("CEMETERY.Gallery.SearchPlaceholder"),
        filterAll:        game.i18n.localize("CEMETERY.Gallery.FilterAll"),
        filterPC:         game.i18n.localize("CEMETERY.Gallery.FilterPC"),
        filterNPC:        game.i18n.localize("CEMETERY.Gallery.FilterNPC"),
        filterDead:       game.i18n.localize("CEMETERY.Gallery.FilterDead"),
        filterRestored:   game.i18n.localize("CEMETERY.Gallery.FilterRestored"),
        sortByDate:       game.i18n.localize("CEMETERY.Gallery.SortByDate"),
        sortByName:       game.i18n.localize("CEMETERY.Gallery.SortByName"),
        noResults:        game.i18n.localize("CEMETERY.Gallery.NoResults"),
        exportJSON:       game.i18n.localize("CEMETERY.Gallery.Export"),
        statTotal:        game.i18n.localize("CEMETERY.Stats.TotalFallen"),
        statPC:           game.i18n.localize("CEMETERY.Stats.TotalPC"),
        statNPC:          game.i18n.localize("CEMETERY.Stats.TotalNPC"),
        statRestored:     game.i18n.localize("CEMETERY.Stats.TotalRestored"),
        viewDetails:      game.i18n.localize("CEMETERY.Card.ViewDetails"),
        edit:             game.i18n.localize("CEMETERY.Card.Edit"),
        restore:          game.i18n.localize("CEMETERY.Card.Restore"),
        remove:           game.i18n.localize("CEMETERY.Card.Remove"),
        restoredLabel:    game.i18n.localize("CEMETERY.Card.Restored"),
        back:             game.i18n.localize("CEMETERY.Detail.Back"),
        timeSince:        game.i18n.localize("CEMETERY.Detail.TimeSinceDeath"),
        deathDate:        game.i18n.localize("CEMETERY.Detail.DeathDate"),
        resurrectedDate:  game.i18n.localize("CEMETERY.Detail.ResurrectionDate"),
        causeOfDeath:     game.i18n.localize("CEMETERY.Detail.CauseOfDeath"),
        lastWords:        game.i18n.localize("CEMETERY.Detail.LastWords"),
        placeOfDeath:     game.i18n.localize("CEMETERY.Detail.PlaceOfDeath"),
        killedBy:         game.i18n.localize("CEMETERY.Detail.KilledBy"),
        memorialText:     game.i18n.localize("CEMETERY.Detail.MemorialText"),
        restoredNotes:    game.i18n.localize("CEMETERY.Detail.ResurrectionNotes"),
        level:            game.i18n.localize("CEMETERY.Card.Level"),
        class_:           game.i18n.localize("CEMETERY.Card.Class"),
        race:             game.i18n.localize("CEMETERY.Card.Race"),
        statusDead:       game.i18n.localize("CEMETERY.Card.Dead"),
        statusRestored:   game.i18n.localize("CEMETERY.Card.Restored"),
      },
    };
  }

  /* ── Event listeners ──────────────────────────────── */

  _onRender(context, options) {
    super._onRender?.(context, options);

    const html = this.element;

    // Search input
    const searchInput = html.querySelector(".cem-search");
    if (searchInput) {
      searchInput.addEventListener("input", foundry.utils.debounce(ev => {
        this._search = ev.target.value;
        this.render();
      }, 250));
    }

    // Filter buttons
    html.querySelectorAll(".cem-filter-btn[data-filter]").forEach(btn => {
      btn.addEventListener("click", () => {
        const group = btn.dataset.group;
        const val   = btn.dataset.filter;
        if (group === "type")   this._typeFilter   = val;
        if (group === "status") this._statusFilter = val;
        this.render();
      });
    });

    // Sort select
    const sortSelect = html.querySelector(".cem-sort-select");
    if (sortSelect) {
      sortSelect.addEventListener("change", ev => {
        this._sortMode = ev.target.value;
        this.render();
      });
    }
  }

  /* ── Static action handlers ───────────────────────── */

  static async #onViewDetail(event, target) {
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!id) return;
    this._view     = "detail";
    this._detailId = id;
    this.render();
  }

  static async #onBackToGallery(event, target) {
    this._view     = "gallery";
    this._detailId = null;
    this.render();
  }

  static async #onShowRegistry(event, target) {
    this._view = "registry";
    this._detailId = null;
    this.render();
  }

  static async #onShowGallery(event, target) {
    this._view = "gallery";
    this._detailId = null;
    this.render();
  }

  static async #onMarkDead(event, target) {

    const actorId =
      target.closest("[data-actor-id]")?.dataset.actorId;

    if (!actorId) return;

    const actor = game.actors.get(actorId);

    if (!actor) return;

    const { RegisterDeathDialog } =
      await import("./RegisterDeathDialog.js");

    const data =
      await RegisterDeathDialog.prompt(actor);

    if (!data) return;

    await MemorialData.registerDeath(
      actor,
      data
    );

    await actor.setFlag(
      "cemetery",
      "dead",
      true
    );

    await actor.setFlag(
      "nimrod-sync",
      "isDead",
      true
    );

    ui.notifications.info(
      `${actor.name} enviado ao memorial`
    );

    this.render();
  }

  static async #onRestoreActorRegistry(event, target) {
    const actorId =
      target.closest("[data-actor-id]")?.dataset.actorId;

    if (!actorId) return;

    const entry =
      MemorialData.getMemorial(actorId);

    if (!entry) return;

    const data =
      await RestoreActorDialog.prompt(entry);

    if (!data) return;

    await MemorialData.restoreActor(
      actorId,
      data
    );

    ui.notifications.info(
      game.i18n.format(
        "CEMETERY.Notification.Restored",
        { name: entry.name }
      )
    );

    this.render();
  }

  static async #onEditEntry(event, target) {
    event.stopPropagation();
    const id    = target.closest("[data-actor-id]")?.dataset.actorId
               ?? this._detailId;
    if (!id) return;

    const entry = MemorialData.getMemorial(id);
    if (!entry) return;

    const data = await EditMemorialDialog.prompt(entry);
    if (!data) return;

    await MemorialData.updateEntry(id, data);
    ui.notifications.info(game.i18n.format("CEMETERY.Notification.Registered", { name: entry.name }));
    this.render();
  }

  static async #onRestoreEntry(event, target) {
    event.stopPropagation();
    const id    = target.closest("[data-actor-id]")?.dataset.actorId
               ?? this._detailId;
    if (!id) return;

    const entry = MemorialData.getMemorial(id);
    if (!entry) return;

    const data = await RestoreActorDialog.prompt(entry);
    if (!data) return;

    await MemorialData.restoreActor(id, data);
    ui.notifications.info(game.i18n.format("CEMETERY.Notification.Restored", { name: entry.name }));
    this.render();
  }

  static async #onRemoveEntry(event, target) {
    event.stopPropagation();
    const id    = target.closest("[data-actor-id]")?.dataset.actorId
               ?? this._detailId;
    if (!id) return;

    const entry = MemorialData.getMemorial(id);
    if (!entry) return;

    const confirmed = await Dialog.confirm({
      title:   game.i18n.localize("CEMETERY.Confirm.RemoveTitle"),
      content: `<p>${game.i18n.format("CEMETERY.Confirm.Remove", { name: entry.name })}</p>`,
    });
    if (!confirmed) return;

    await MemorialData.removeEntry(id);
    ui.notifications.info(game.i18n.format("CEMETERY.Notification.Removed", { name: entry.name }));

    // If we were viewing this entry's detail, go back to gallery
    if (this._view === "detail" && this._detailId === id) {
      this._view     = "gallery";
      this._detailId = null;
    }
    this.render();
  }

  static async #onExportJSON(event, target) {
    MemorialData.exportJSON();
    ui.notifications.info(
      game.i18n.localize("CEMETERY.Notification.Exported")
    );
  }

  /* ── Registry ─────────────────────────────────────── */

  _getRegistryActors() {
    return game.actors.contents.map(actor => {
      const memorial = MemorialData.getMemorial(actor.id);

      return {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        type: actor.type,
        dead: !!memorial && !memorial.restored,
        restored: memorial?.restored ?? false,
        important: actor.getFlag("cemetery", "important") ?? false,
      };
    });
  }
}