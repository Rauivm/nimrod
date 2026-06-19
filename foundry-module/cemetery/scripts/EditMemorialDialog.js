/**
 * EditMemorialDialog
 * Dialog for editing an existing memorial entry's custom fields.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EditMemorialDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {object} entry - Memorial entry */
  constructor(entry, options = {}) {
    super(options);
    this._entry   = entry;
    this._resolve = null;
  }

  static async prompt(entry) {
    return new Promise((resolve) => {
      const dlg = new EditMemorialDialog(entry);
      dlg._resolve = resolve;
      dlg.render(true);
    });
  }

  static DEFAULT_OPTIONS = {
    id:       "cemetery-edit-dialog",
    tag:      "div",
    window: {
      title:      "CEMETERY.Dialog.TitleEdit",
      resizable:  true,
    },
    position: {
      width:  480,
      height: "auto",
    },
    actions: {
      save:   EditMemorialDialog.#onSave,
      cancel: EditMemorialDialog.#onCancel,
    },
  };

  static PARTS = {
    main: {
      template: "modules/cemetery/templates/edit-dialog.hbs",
    },
  };

  async _prepareContext() {
    return {
      entry: this._entry,
      i18n: {
        causeOfDeath: game.i18n.localize("CEMETERY.Dialog.CauseOfDeath"),
        lastWords:    game.i18n.localize("CEMETERY.Dialog.LastWords"),
        placeOfDeath: game.i18n.localize("CEMETERY.Dialog.PlaceOfDeath"),
        killedBy:     game.i18n.localize("CEMETERY.Dialog.KilledBy"),
        memorialText: game.i18n.localize("CEMETERY.Dialog.MemorialText"),
        save:         game.i18n.localize("CEMETERY.Dialog.Save"),
        cancel:       game.i18n.localize("CEMETERY.Dialog.Cancel"),
      },
    };
  }

  static async #onSave(event, target) {
    const form = this.element.querySelector("form");
    const data = {
      causeOfDeath: form.causeOfDeath?.value?.trim()  ?? "",
      lastWords:    form.lastWords?.value?.trim()     ?? "",
      placeOfDeath: form.placeOfDeath?.value?.trim()  ?? "",
      killedBy:     form.killedBy?.value?.trim()      ?? "",
      memorialText: form.memorialText?.value?.trim()  ?? "",
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
