/**
 * scripts/SessionSync.js  — v5 (session_events + resource_deltas)
 *
 * Cliente HTTP para os dois domínios de evento do Nimrod:
 *
 *   sendEvent(payload)        → POST /sessions/:id/events           (resource_deltas)
 *   sendSessionEvent(payload) → POST /sessions/:id/session-events   (session_events)
 *
 * São domínios diferentes no backend (resource_deltas = consumo de recurso,
 * sempre com dono; session_events = fatos estruturais da sessão — presença,
 * cena, combate, tokens — dono opcional). Por isso duas rotas, dois corpos
 * de request diferentes — mas UM único cliente HTTP, compartilhando toda a
 * lógica de retry/dedup/erro (#send privado). Não são duas APIs paralelas.
 *
 * Autenticação:
 *   Usa X-Nimrod-Key (FOUNDRY_API_KEY configurada em Module Settings).
 *   Não há mais JWT de lançamento — o sessionId vem via world setting
 *   preenchida pelo nimrod-bridge após o handshake.
 *
 * API pública:
 *   await SessionSync.sendEvent(payload)         — evento de recurso (HP/ouro/XP/...)
 *   await SessionSync.sendSessionEvent(payload)   — evento estrutural (presença/cena/combate/...)
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

  /**
   * Lógica compartilhada entre sendEvent() e sendSessionEvent(): checa
   * enabled/sessionId, deduplica por eventId, envia, cacheia, loga.
   * Não decide o formato do body nem a rota — isso é responsabilidade de
   * cada método público.
   *
   * @param {string} path        - path relativo (após baseUrl)
   * @param {object} body        - corpo já no formato esperado pelo endpoint
   * @param {string} eventId     - chave de deduplicação
   * @param {string} logLabel    - texto de sucesso no console
   * @returns {Promise<object|null>}
   */
  static async #send(path, body, eventId, logLabel) {
    if (!this.enabled) return null;

    if (!this.activeSessionId) {
      console.warn(`nimrod-session | ${logLabel} ignorado: sem sessão ativa (handshake pendente).`);
      return null;
    }

    if (this.#sent.has(eventId)) return null;

    try {
      const result = await this.#post(path, body);
      this.#sent.add(eventId);
      // Cache de deduplicação — evita crescimento indefinido em sessões longas
      if (this.#sent.size > 5000) this.#sent.clear();

      console.log(`%cnimrod-session | ✓ ${logLabel}`, 'color:#4a9a6a');
      return result;
    } catch (err) {
      console.warn(`nimrod-session | Falha ao enviar (${logLabel}):`, err.message);
      return null;
    }
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  static async sendEvent(payload) {
    if (!payload.actorId) {
      console.warn('nimrod-session | sendEvent ignorado: actorId é obrigatório.', payload);
      return null;
    }

    const eventId = payload.foundryEventId
      ?? `fvtt-${game.world.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // O módulo não envia playerId. O backend resolve playerId e characterId
    // a partir do actorId (player_characters.foundry_actor_id).
    const body = {
      actorId:        payload.actorId,
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

    const deltaLabel = payload.delta == null
      ? ''
      : ` ${payload.delta > 0 ? '+' : ''}${payload.delta}`;

    return this.#send(
      `/sessions/${this.activeSessionId}/events`,
      body, eventId,
      `${payload.resourceType}${deltaLabel} → ${payload.actorName}`,
    );
  }

  /**
   * Envia um evento estrutural (session_events) — presença, cena, combate,
   * tokens, etc. Diferente de sendEvent(): actorId é OPCIONAL aqui (muitos
   * eventos genuinamente não têm um ator, ex: SCENE_CHANGED).
   *
   * @param {object} payload
   * @param {string}  payload.eventType       - ex: 'PLAYER_CONNECTED', 'SCENE_CHANGED'
   * @param {string}  [payload.actorId]       - Foundry actor._id, se houver
   * @param {string}  [payload.actorName]
   * @param {string}  [payload.foundryName]   - game.user.name — habilita resolução por identidade humana
   * @param {string}  [payload.characterId]
   * @param {string}  [payload.playerId]
   * @param {object}  [payload.payload]       - dados específicos do evento (nunca narrativo)
   * @param {string}  [payload.foundryEventId]
   * @param {string}  [payload.occurredAt]
   */
  static async sendSessionEvent(payload) {
    if (!payload.eventType) {
      console.warn('nimrod-session | sendSessionEvent ignorado: eventType é obrigatório.', payload);
      return null;
    }

    const eventId = payload.foundryEventId
      ?? `fvtt-${game.world.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const body = {
      eventType:      payload.eventType,
      actorId:        payload.actorId     ?? null,
      actorName:      payload.actorName   ?? null,
      foundryName:    payload.foundryName ?? null,
      characterId:    payload.characterId ?? null,
      playerId:       payload.playerId    ?? null,
      payload:        payload.payload     ?? {},
      foundryEventId: eventId,
      occurredAt:     payload.occurredAt  ?? new Date().toISOString(),
    };

    return this.#send(
      `/sessions/${this.activeSessionId}/session-events`,
      body, eventId,
      `${payload.eventType}${payload.actorName ? ` → ${payload.actorName}` : ''}`,
    );
  }

  static async ping() {
    if (!this.baseUrl) { console.warn('nimrod-session | URL não configurada.'); return false; }
    try {
      // /health é registrado sem prefixo /api no backend — remove o /api
      // que baseUrl acrescenta para os demais endpoints.
      const rootUrl = this.baseUrl.replace(/\/api$/, '');
      const res = await fetch(`${rootUrl}/health`);
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