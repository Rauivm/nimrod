/**
 * NimrodSync
 * Integração com o sistema Nimrod Sync.
 *
 * Envia eventos de morte/ressurreição para o endpoint configurado,
 * marcando atores com isDead = true/false.
 *
 * Configuração (em Configurações do Módulo):
 *   - cemetery.nimrodSyncEnabled  → boolean (default: true)
 *   - cemetery.nimrodSyncUrl      → URL base do Nimrod Sync
 *   - cemetery.nimrodSyncToken    → Bearer token de autenticação
 *
 * Uso via API pública:
 *   await Cemetery.nimrod.markDead(actor, memorialEntry);
 *   await Cemetery.nimrod.markRestored(actorId, memorialEntry);
 *   await Cemetery.nimrod.syncAll();
 *   Cemetery.nimrod.status();
 */

const MODULE_ID = "cemetery";

export class NimrodSync {

  /* ── Config helpers ───────────────────────────────── */

  static get enabled() {
    try {
      return game.settings.get(MODULE_ID, "nimrodSyncEnabled");
    } catch { return false; }
  }

  static get baseUrl() {
    try {
      return (game.settings.get(MODULE_ID, "nimrodSyncUrl") ?? "").replace(/\/$/, "");
    } catch { return ""; }
  }

  static get token() {
    try {
      return game.settings.get(MODULE_ID, "nimrodSyncToken") ?? "";
    } catch { return ""; }
  }

  static get headers() {
    const h = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  /* ── Validation ───────────────────────────────────── */

  static _assertReady() {
    if (!this.enabled)  throw new Error("Nimrod Sync está desativado nas configurações.");
    if (!this.baseUrl)  throw new Error("Nimrod Sync URL não configurada (cemetery.nimrodSyncUrl).");
  }

  /* ── Core request ─────────────────────────────────── */

  /**
   * Low-level POST helper.
   * @param {string}  path     - Endpoint path (e.g. "/actors/isDead")
   * @param {object}  payload  - JSON body
   * @returns {Promise<object>} Response JSON
   */
  static async _post(path, payload) {
    this._assertReady();

    const url = `${this.baseUrl}${path}`;
    console.log(`%cCemetery | Nimrod Sync → POST ${url}`, "color:#4a9a6a", payload);

    const res = await fetch(url, {
      method:  "POST",
      headers: this.headers,
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Nimrod Sync HTTP ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    return contentType.includes("application/json") ? res.json() : { ok: true };
  }

  /**
   * Low-level PATCH helper (for partial updates).
   */
  static async _patch(path, payload) {
    this._assertReady();

    const url = `${this.baseUrl}${path}`;
    console.log(`%cCemetery | Nimrod Sync → PATCH ${url}`, "color:#4a9a6a", payload);

    const res = await fetch(url, {
      method:  "PATCH",
      headers: this.headers,
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Nimrod Sync HTTP ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    return contentType.includes("application/json") ? res.json() : { ok: true };
  }

  /* ── Public API ───────────────────────────────────── */

  /**
   * Marca um ator como morto no Nimrod Sync.
   * Chamado automaticamente ao registrar uma morte.
   *
   * Payload enviado:
   * {
   *   actorId:      string,
   *   actorName:    string,
   *   actorType:    string,
   *   isDead:       true,
   *   deathDate:    ISO string,
   *   causeOfDeath: string,
   *   placeOfDeath: string,
   *   killedBy:     string,
   *   world:        string,
   *   module:       "cemetery"
   * }
   *
   * @param {Actor}  actor   - Foundry Actor
   * @param {object} entry   - Memorial entry snapshot
   */
  static async markDead(actor, entry = {}) {
    if (!this.enabled) return null;

    const payload = {
      actorId:      actor.id,
      actorName:    actor.name,
      actorType:    actor.type,
      isDead:       true,
      deathDate:    entry.deathDate    ?? new Date().toISOString(),
      causeOfDeath: entry.causeOfDeath ?? "",
      placeOfDeath: entry.placeOfDeath ?? "",
      killedBy:     entry.killedBy     ?? "",
      lastWords:    entry.lastWords    ?? "",
      world:        game.world.id,
      module:       MODULE_ID,
    };

    try {
      const result = await this._patch(`/actors/${actor.id}/status`, payload);
      console.log(`%cCemetery | Nimrod Sync: ${actor.name} marcado como isDead`, "color:#4a9a6a", result);
      return result;
    } catch (err) {
      // Fallback: tenta endpoint genérico /sync/death
      console.warn("Cemetery | Nimrod Sync /actors/:id/status falhou, tentando /sync/death...");
      return this._post("/sync/death", payload);
    }
  }

  /**
   * Marca um ator como ressuscitado no Nimrod Sync.
   * Chamado automaticamente ao restaurar um personagem.
   *
   * @param {string} actorId - ID do ator
   * @param {object} entry   - Memorial entry snapshot
   */
  static async markRestored(actorId, entry = {}) {
    if (!this.enabled) return null;

    const payload = {
      actorId,
      actorName:      entry.name          ?? actorId,
      isDead:         false,
      restoredDate:   entry.restoredDate  ?? new Date().toISOString(),
      restoredNotes:  entry.restoredNotes ?? "",
      world:          game.world.id,
      module:         MODULE_ID,
    };

    try {
      const result = await this._patch(`/actors/${actorId}/status`, payload);
      console.log(`%cCemetery | Nimrod Sync: ${actorId} marcado como restaurado`, "color:#4a9a6a", result);
      return result;
    } catch (err) {
      console.warn("Cemetery | Nimrod Sync /actors/:id/status falhou, tentando /sync/restore...");
      return this._post("/sync/restore", payload);
    }
  }

  /**
   * Sincroniza todos os registros do memorial com o Nimrod Sync.
   * Útil para uma sincronização inicial ou resync manual.
   *
   * Uso: Cemetery.nimrod.syncAll()
   *
   * @returns {Promise<{sent: number, errors: number}>}
   */
  static async syncAll() {
    this._assertReady();

    const { MemorialData } = await import("./MemorialData.js");
    const entries = MemorialData.getAllFallen();

    let sent   = 0;
    let errors = 0;

    for (const entry of entries) {
      try {
        const payload = {
          actorId:       entry.id,
          actorName:     entry.name,
          actorType:     entry.type,
          isDead:        !entry.restored,
          deathDate:     entry.deathDate,
          causeOfDeath:  entry.causeOfDeath,
          placeOfDeath:  entry.placeOfDeath,
          killedBy:      entry.killedBy,
          restored:      entry.restored,
          restoredDate:  entry.restoredDate,
          world:         game.world.id,
          module:        MODULE_ID,
        };
        await this._patch(`/actors/${entry.id}/status`, payload);
        sent++;
      } catch (err) {
        console.error(`Cemetery | Nimrod Sync failed for ${entry.name}:`, err.message);
        errors++;
      }
    }

    const msg = `Nimrod Sync concluído: ${sent} enviados, ${errors} erros.`;
    console.log(`%cCemetery | ${msg}`, "color:#4a9a6a");
    if (errors > 0) ui.notifications.warn(`Cemetery | ${msg}`);
    else             ui.notifications.info(`Cemetery | ${msg}`);

    return { sent, errors };
  }

  /**
   * Exibe o status atual da integração no console.
   * Uso: Cemetery.nimrod.status()
   */
  static status() {
    const { MemorialData } = /** @type {any} */(window.Cemetery?.data ?? {});
    console.group("%cCemetery | Nimrod Sync Status", "color:#c9a84c;font-weight:bold");
    console.log("Enabled:   ", this.enabled);
    console.log("Base URL:  ", this.baseUrl || "(não configurado)");
    console.log("Token:     ", this.token ? "***" + this.token.slice(-4) : "(não configurado)");
    console.log("Mundo:     ", game.world.id);
    console.groupEnd();
    return {
      enabled: this.enabled,
      url:     this.baseUrl,
      hasToken: !!this.token,
    };
  }

  /**
   * Testa a conexão com o Nimrod Sync.
   * Uso: await Cemetery.nimrod.ping()
   */
  static async ping() {
    this._assertReady();
    try {
      const res = await fetch(`${this.baseUrl}/ping`, { headers: this.headers });
      const ok  = res.ok;
      console.log(`%cCemetery | Nimrod Sync ping: ${ok ? "✅ OK" : "❌ FALHOU"} (${res.status})`, ok ? "color:#4a9a6a" : "color:#c04040");
      return ok;
    } catch (err) {
      console.error("Cemetery | Nimrod Sync ping error:", err.message);
      return false;
    }
  }
}