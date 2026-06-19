/**
 * Memorial Data Manager
 * Handles all data operations for the Cemetery module.
 * Data is persisted as World-level flags.
 */
 
const MODULE_ID = "cemetery";
const FLAG_KEY  = "memorial-dos-caidos";
 
export class MemorialData {
 
  /* ── Internal helpers ─────────────────────────────── */
 
  static _getWorldFlags() {
    return game.settings.get(MODULE_ID, "memorialData") ?? {};
  }
 
  static async _setWorldFlags(data) {
    await game.settings.set(MODULE_ID, "memorialData", data);
  }
 
  /* ── CRUD ─────────────────────────────────────────── */
 
  /**
   * Register a character death in the memorial.
   * @param {Actor}  actor   - The Foundry Actor being registered
   * @param {object} extra   - Custom death data from the dialog
   * @returns {string} The new memorial entry id
   */
  static async registerDeath(actor, extra = {}) {
    const all = this._getWorldFlags();
 
    // Check duplicate
    if (all[actor.id] && !all[actor.id].restored) {
      throw new Error(game.i18n.format("CEMETERY.Notification.AlreadyInMemorial", { name: actor.name }));
    }
 
    const now = new Date();
 
    // Try to extract common system fields — works for dnd5e, pf2e, etc.
    const sysData = actor.system ?? {};
    const level   = sysData.details?.level?.value
                 ?? sysData.details?.level
                 ?? sysData.advancement?.level
                 ?? sysData.level
                 ?? null;
    const cls     = sysData.details?.class
                 ?? sysData.class?.name
                 ?? null;
    const race    = sysData.details?.race?.name
                 ?? sysData.details?.race
                 ?? null;
 
    const entry = {
      id:             actor.id,
      name:           actor.name,
      type:           actor.type,
      img:            actor.img,
      world:          game.world.id,
      user:           game.user?.name ?? null,
      level:          level,
      class:          cls,
      race:           race,
      deathDate:      now.toISOString(),
      registeredAt:   now.toISOString(),
      causeOfDeath:   extra.causeOfDeath   ?? "",
      lastWords:      extra.lastWords      ?? "",
      placeOfDeath:   extra.placeOfDeath   ?? "",
      killedBy:       extra.killedBy       ?? "",
      memorialText:   extra.memorialText   ?? "",
      restored:       false,
      restoredDate:   null,
      restoredNotes:  "",
      // GM-controlled visibility for the public memorial gallery.
      // PCs are visible by default (players naturally want to see fallen
      // companions). NPCs default to hidden — the GM must explicitly
      // reveal them, since many NPC deaths are spoilers or backstage info.
      visibleToPlayers: extra.visibleToPlayers ?? (actor.type === "character"),
    };
 
    all[actor.id] = entry;
    await this._setWorldFlags(all);
    return actor.id;
  }
 
  /**
   * Update custom fields of an existing memorial entry.
   */
  static async updateEntry(actorId, data) {
    const all = this._getWorldFlags();
    if (!all[actorId]) throw new Error(`Memorial entry not found: ${actorId}`);
    all[actorId] = foundry.utils.mergeObject(all[actorId], data, { inplace: false });
    await this._setWorldFlags(all);
  }
 
  /**
   * Mark a character as restored (resurrected).
   */
  static async restoreActor(actorId, { restoredDate, restoredNotes } = {}) {
 
    const all = this._getWorldFlags();
 
    if (!all[actorId]) {
      throw new Error(`Memorial entry not found: ${actorId}`);
    }
 
    all[actorId].restored = true;
    all[actorId].restoredDate =
      restoredDate ?? new Date().toISOString();
    all[actorId].restoredNotes =
      restoredNotes ?? "";
 
    await this._setWorldFlags(all);
 
    // ── Nimrod Sync ─────────────────────────────
 
    const actor = game.actors.get(actorId);
 
    if (actor) {
 
      await actor.setFlag(
        "nimrod-sync",
        "isDead",
        false
      );
 
      await actor.setFlag(
        "cemetery",
        "dead",
        false
      );
    }
  }
 
  /**
   * Permanently remove an entry from the memorial.
   */
  static async removeEntry(actorId) {
 
    const actor = game.actors.get(actorId);
 
    if (actor) {
 
      await actor.setFlag(
        "nimrod-sync",
        "isDead",
        false
      );
 
      await actor.setFlag(
        "cemetery",
        "dead",
        false
      );
    }
 
    const all = this._getWorldFlags();
 
    delete all[actorId];
 
    await this._setWorldFlags(all);
  }
 
  /* ── Read ─────────────────────────────────────────── */
 
  static getAllFallen() {
    const all = this._getWorldFlags();
    return Object.values(all);
  }
 
  static getMemorial(actorId) {
    return this._getWorldFlags()[actorId] ?? null;
  }
 
  static isInMemorial(actorId) {
    return actorId in this._getWorldFlags();
  }
 
  /* ── Stats ────────────────────────────────────────── */
 
  static getStats() {
    const all = this.getAllFallen();
    return {
      total:     all.length,
      pc:        all.filter(e => e.type === "character").length,
      npc:       all.filter(e => e.type === "npc").length,
      restored:  all.filter(e => e.restored).length,
    };
  }
 
  /* ── Export ───────────────────────────────────────── */
 
  static exportJSON() {
    const payload = {
      module:    MODULE_ID,
      world:     game.world.id,
      exported:  new Date().toISOString(),
      entries:   this.getAllFallen(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `memorial-${game.world.id}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
 
  /* ── Filter & sort helpers ────────────────────────── */
 
  static filter({ search = "", typeFilter = "all", statusFilter = "all" } = {}) {
    let list = this.getAllFallen();
 
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }
 
    if (typeFilter === "pc")  list = list.filter(e => e.type === "character");
    if (typeFilter === "npc") list = list.filter(e => e.type === "npc");
 
    if (statusFilter === "dead")      list = list.filter(e => !e.restored);
    if (statusFilter === "restored")  list = list.filter(e => e.restored);
 
    return list;
  }
 
  static sortByDate(list) {
    return [...list].sort((a, b) => new Date(b.deathDate) - new Date(a.deathDate));
  }
 
  static sortByName(list) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }
 
  /* ── Time helper ──────────────────────────────────── */
 
  static timeSinceDeath(isoDate) {
    if (!isoDate) return "";
    const diff  = Date.now() - new Date(isoDate).getTime();
    const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const rem   = days % 365 % 30;
 
    const y = game.i18n.localize("CEMETERY.Detail.Years");
    const m = game.i18n.localize("CEMETERY.Detail.Months");
    const d = game.i18n.localize("CEMETERY.Detail.Days");
 
    if (years > 0) return `${years} ${y}, ${months} ${m}`;
    if (months > 0) return `${months} ${m}, ${rem} ${d}`;
    if (days > 0)   return `${days} ${d}`;
    return game.i18n.localize("CEMETERY.Detail.Today");
  }
 
  static formatDate(isoDate) {
    if (!isoDate) return "—";
    return new Date(isoDate).toLocaleDateString(game.i18n.lang, {
      year: "numeric", month: "long", day: "numeric"
    });
  }
}