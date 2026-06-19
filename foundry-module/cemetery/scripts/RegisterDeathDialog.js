/**
 * RegisterDeathDialog
 * Dialog shown when sending an actor to the memorial.
 * Collects custom death data from the GM.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RegisterDeathDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {Actor} actor */
  constructor(actor, options = {}) {
    super(options);
    this._actor   = actor;
    this._resolve = null;
  }

  /* ── Static factory ───────────────────────────────── */

  /**
   * Open the dialog and return the form data, or null if cancelled.
   * @param {Actor} actor
   * @returns {Promise<object|null>}
   */
  static async prompt(actor) {
    return new Promise((resolve) => {
      const dlg = new RegisterDeathDialog(actor);
      dlg._resolve = resolve;
      dlg.render(true);
    });
  }

  /* ── AppV2 config ─────────────────────────────────── */

  static DEFAULT_OPTIONS = {
    id:       "cemetery-register-dialog",
    tag:      "div",
    window: {
      title:      "CEMETERY.Dialog.TitleRegister",
      resizable:  false,
    },
    position: {
      width:  480,
    },
    actions: {
      confirm: RegisterDeathDialog.#onConfirm,
      cancel:  RegisterDeathDialog.#onCancel,
    },
  };

  static PARTS = {
    main: {
      template: "modules/cemetery/templates/register-dialog.hbs",
    },
  };

  async _prepareContext() {
    const actor = this._actor;
    return {
      actor: {
        name: actor.name,
        img:  actor.img,
        type: actor.type,
      },
      i18n: {
        causeOfDeath: game.i18n.localize("CEMETERY.Dialog.CauseOfDeath"),
        lastWords:    game.i18n.localize("CEMETERY.Dialog.LastWords"),
        placeOfDeath: game.i18n.localize("CEMETERY.Dialog.PlaceOfDeath"),
        killedBy:     game.i18n.localize("CEMETERY.Dialog.KilledBy"),
        memorialText: game.i18n.localize("CEMETERY.Dialog.MemorialText"),
        confirm:      game.i18n.localize("CEMETERY.Dialog.Confirm"),
        cancel:       game.i18n.localize("CEMETERY.Dialog.Cancel"),
        pc:           game.i18n.localize("CEMETERY.Card.PC"),
        npc:          game.i18n.localize("CEMETERY.Card.NPC"),
      },
    };
  }

  /* ── Actions ──────────────────────────────────────── */

  static async #onConfirm(event, target) {
    const form = this.element.querySelector("form");
    const data = {
      causeOfDeath: form.causeOfDeath?.value?.trim()  ?? "",
      lastWords:    form.lastWords?.value?.trim()     ?? "",
      placeOfDeath: form.placeOfDeath?.value?.trim()  ?? "",
      killedBy:     form.killedBy?.value?.trim()      ?? "",
      memorialText: form.memorialText?.value?.trim()  ?? "",
    };
    this._resolve?.(data);
    this.close();
  }

  static async #onCancel(event, target) {
    this._resolve?.(null);
    this.close();
  }

  /** Resolve null when the window X is clicked. */
  async close(options = {}) {
    this._resolve?.(null);
    this._resolve = null;
    return super.close(options);
  }
}
