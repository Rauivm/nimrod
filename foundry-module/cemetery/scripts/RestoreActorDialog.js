/**
 * RestoreActorDialog
 * Dialog shown when resurrecting a character from the memorial.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RestoreActorDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {object} entry - Memorial entry */
  constructor(entry, options = {}) {
    super(options);
    this._entry   = entry;
    this._resolve = null;
  }

  static async prompt(entry) {
    return new Promise((resolve) => {
      const dlg = new RestoreActorDialog(entry);
      dlg._resolve = resolve;
      dlg.render(true);
    });
  }

  static DEFAULT_OPTIONS = {
    id:       "cemetery-restore-dialog",
    tag:      "div",
    window: {
      title:      "CEMETERY.Dialog.TitleRestore",
      resizable:  false,
    },
    position: {
      width:  420,
    },
    actions: {
      confirm: RestoreActorDialog.#onConfirm,
      cancel:  RestoreActorDialog.#onCancel,
    },
  };

  static PARTS = {
    main: {
      template: "modules/cemetery/templates/restore-dialog.hbs",
    },
  };

  async _prepareContext() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      entry: this._entry,
      today,
      i18n: {
        restoredDate:  game.i18n.localize("CEMETERY.Dialog.ResurrectionDate"),
        restoredNotes: game.i18n.localize("CEMETERY.Dialog.ResurrectionNotes"),
        confirm:       game.i18n.localize("CEMETERY.Dialog.Restore"),
        cancel:        game.i18n.localize("CEMETERY.Dialog.Cancel"),
      },
    };
  }

  static async #onConfirm(event, target) {
    const form = this.element.querySelector("form");
    const dateVal = form.restoredDate?.value?.trim();
    const data = {
      restoredDate:  dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
      restoredNotes: form.restoredNotes?.value?.trim() ?? "",
    };
    this._resolve?.(data);
    this._resolve = null;
    this.close();
  }

  static async #onCancel(event, target) {
    this._resolve?.(null);
    this._resolve = null;
    this.close();
  }

  async close(options = {}) {
    this._resolve?.(null);
    this._resolve = null;
    return super.close(options);
  }
}
