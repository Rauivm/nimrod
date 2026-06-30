/**
 * scripts/SessionSync.js  — v3 (handshake architecture)
 *
 * Cliente HTTP para o endpoint de sessões do Nimrod.
 *
 * Autenticação:
 *   Usa X-Nimrod-Key (FOUNDRY_API_KEY configurada em Module Settings).
 *   Não há mais JWT de lançamento — o sessionId vem via world setting
 *   preenchida pelo nimrod-bridge após o handshake.
 *
 * API pública:
 *   await SessionSync.sendEvent(payload)
 *   await SessionSync.ping()
 *   SessionSync.status()
 *   SessionSync.clearSentCache()
 */

const MODULE_ID = 'nimrod-session';

export class SessionSync {

  static #sent = new Set();

  // ─── Config ────────────────────────────────────────────────────────────────

  static get enabled() {
    try { return game.settings.get(MODULE_ID, 'syncEnabled'); }
    catch { return false; }
  }

/*   static get baseUrl() {
    try {
      // Tenta nimrod-session primeiro, depois nimrod-bridge (mesma setting)
      const url = game.settings.get(MODULE_ID, 'nimrodUrl')
               ?? game.settings.get('nimrod-bridge', 'nimrodUrl')
               ?? '';
      return url.replace(/\/$/, '');
    } catch { return ''; }
  } */
 static get baseUrl() {
    try {
      const url =
        game.settings.get(MODULE_ID, "nimrodUrl")
        ?? game.settings.get("nimrod-bridge", "nimrodUrl")
        ?? "";

      const normalized = url.replace(/\/$/, "");

      return normalized.endsWith("/api")
        ? normalized
        : `${normalized}/api`;
    } catch {
      return "";
    }
  }

  static get apiKey() {
    try {
      return game.settings.get(MODULE_ID, 'nimrodApiKey')
          ?? game.settings.get('nimrod-bridge', 'nimrodApiKey')
          ?? '';
    } catch { return ''; }
  }

  static get activeSessionId() {
    try {
      // Prioridade: própria setting → nimrod-bridge setting
      return game.settings.get(MODULE_ID, 'activeSessionId')
          || game.settings.get('nimrod-bridge', 'activeSessionId')
          || '';
    } catch { return ''; }
  }

  static get #headers() {
    const h = { 'Content-Type': 'application/json' };
    const key = this.apiKey;
    if (key) h['X-Nimrod-Key'] = key;
    return h;
  }

  // ─── Validação ─────────────────────────────────────────────────────────────

  static #assertReady() {
    if (!this.enabled)         throw new Error('nimrod-session: sync desativado.');
    if (!this.baseUrl)         throw new Error('nimrod-session: URL do Nimrod não configurada.');
    if (!this.activeSessionId) throw new Error('nimrod-session: sessionId não disponível — aguardando handshake.');
    if (!this.apiKey)          throw new Error('nimrod-session: API Key não configurada.');
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  static async #post(path, payload, attempt = 0) {
    this.#assertReady();

    const url = `${this.baseUrl}${path}`;

    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: this.#headers,
        body:    JSON.stringify(payload),
      });
    } catch (netErr) {
      if (attempt < 2) {
        const delay = 1000 * 2 ** attempt;
        await new Promise(r => setTimeout(r, delay));
        return this.#post(path, payload, attempt + 1);
      }
      throw netErr;
    }

    if (res.status === 409) return { ok: true, duplicate: true };

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      if ((res.status === 400 || res.status === 422)) {
        throw new Error(`payload inválido (${res.status}): ${text}`);
      }
      if (res.status >= 500 && attempt < 2) {
        const delay = 1000 * 2 ** attempt;
        await new Promise(r => setTimeout(r, delay));
        return this.#post(path, payload, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? res.json() : { ok: true };
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  static async sendEvent(payload) {
    if (!this.enabled) return null;

    const sessionId = this.activeSessionId;
    if (!sessionId) {
      console.warn('nimrod-session | sendEvent ignorado: sem sessão ativa (handshake pendente).');
      return null;
    }

    const eventId = payload.foundryEventId
      ?? `fvtt-${game.world.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (this.#sent.has(eventId)) return null;

    const body = {
      sessionId,
      playerId:       payload.playerId,
      actorName:      payload.actorName,
      resourceType:   payload.resourceType,
      delta:          payload.delta,
      valueBefore:    payload.valueBefore  ?? null,
      valueAfter:     payload.valueAfter   ?? null,
      deltaMeta:      payload.deltaMeta    ?? {},
      description:    payload.description  ?? null,
      foundryEventId: eventId,
      occurredAt:     payload.occurredAt   ?? new Date().toISOString(),
      source:         'foundry',
    };

    try {
      // const result = await this.#post('/nimrod/session/event', body);
      const result = await this.#post(
          `/sessions/${this.activeSessionId}/events`,
          body
      );
      this.#sent.add(eventId);
      console.log(
        `%cnimrod-session | ✓ ${payload.resourceType} ${payload.delta > 0 ? '+' : ''}${payload.delta} → ${payload.actorName}`,
        'color:#4a9a6a',
      );
      return result;
    } catch (err) {
      console.warn('nimrod-session | Falha ao enviar evento:', err.message);
      return null;
    }
  }

  static async ping() {
    if (!this.baseUrl) { console.warn('nimrod-session | URL não configurada.'); return false; }
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      const ok  = res.ok || res.status === 404;
      console.log(`nimrod-session | Ping: ${ok ? '✅ OK' : '❌ FALHOU'} (${res.status})`);
      return ok;
    } catch (err) {
      console.error('nimrod-session | Ping falhou:', err.message);
      return false;
    }
  }

  static status() {
    console.group('%cnimrod-session | Status', 'color:#c9a84c;font-weight:bold');
    console.log('Enabled:       ', this.enabled);
    console.log('URL:           ', this.baseUrl   || '(não configurada)');
    console.log('API Key:       ', this.apiKey    ? '✅ presente' : '⚠️ ausente');
    console.log('Sessão ativa:  ', this.activeSessionId || '(aguardando handshake)');
    console.log('Eventos enviados:', this.#sent.size);
    console.groupEnd();
    return {
      enabled:         this.enabled,
      url:             this.baseUrl,
      hasApiKey:       !!this.apiKey,
      activeSessionId: this.activeSessionId,
      sentCount:       this.#sent.size,
    };
  }

  static clearSentCache() {
    const n = this.#sent.size;
    this.#sent.clear();
    console.log(`nimrod-session | Cache limpo (${n} entradas).`);
  }
}