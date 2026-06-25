/**
 * scripts/SessionSync.js
 *
 * Cliente HTTP para o endpoint de sessões do Nimrod.
 *
 * Responsabilidades:
 *   - Ler configurações (URL base, token, sessionId ativo)
 *   - Enviar eventos via POST /api/sessions/:id/events
 *   - Idempotência: cada evento carrega um foundryEventId único
 *   - Retry com backoff exponencial (3 tentativas)
 *   - Deduplicação local: nunca envia o mesmo foundryEventId duas vezes na sessão
 *
 * API pública:
 *   await SessionSync.sendEvent(payload)   → envia um evento de recurso
 *   await SessionSync.ping()               → testa a conexão com o backend
 *   SessionSync.status()                   → imprime status no console
 *   SessionSync.activeSessionId            → getter para o ID da sessão ativa
 */

const MODULE_ID = "nimrod-session";

export class SessionSync {

  /** Cache de foundryEventIds já enviados nesta sessão de jogo (evita duplicatas por reconexão). */
  static #sent = new Set();

  // ─── Config helpers ──────────────────────────────────────────────────────────

  static get enabled() {
    try { return game.settings.get(MODULE_ID, "syncEnabled"); }
    catch { return false; }
  }

  static get baseUrl() {
    try {
      return (game.settings.get(MODULE_ID, "nimrodUrl") ?? "").replace(/\/$/, "");
    } catch { return ""; }
  }

  static get token() {
    try { return game.settings.get(MODULE_ID, "nimrodToken") ?? ""; }
    catch { return ""; }
  }

  static get activeSessionId() {
    try { return game.settings.get(MODULE_ID, "activeSessionId") ?? ""; }
    catch { return ""; }
  }

  static get #headers() {
    const h = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  // ─── Validação ───────────────────────────────────────────────────────────────

  static #assertReady() {
    if (!this.enabled)         throw new Error("nimrod-session: sync desativado nas configurações.");
    if (!this.baseUrl)         throw new Error("nimrod-session: URL do Nimrod não configurada.");
    if (!this.activeSessionId) throw new Error("nimrod-session: nenhuma sessão ativa configurada.");
  }

  // ─── HTTP core ───────────────────────────────────────────────────────────────

  /**
   * POST com retry (backoff exponencial: 1s, 2s, 4s).
   * @param {string} path
   * @param {object} payload
   * @param {number} [attempt]
   */
  static async #post(path, payload, attempt = 0) {
    this.#assertReady();

    const url = `${this.baseUrl}${path}`;
    console.log(
      `%cnimrod-session | → POST ${url} (tentativa ${attempt + 1})`,
      "color:#4a9a6a", payload,
    );

    let res;
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: this.#headers,
        body:    JSON.stringify(payload),
      });
    } catch (networkErr) {
      // Rede inacessível — retry se ainda temos tentativas
      if (attempt < 2) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`nimrod-session | Rede inacessível, retry em ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
        return this.#post(path, payload, attempt + 1);
      }
      throw networkErr;
    }

    // 409 = foundryEventId duplicado → idempotente, não é erro
    if (res.status === 409) {
      console.log("nimrod-session | Evento já registrado no servidor (409 — ok).");
      return { ok: true, duplicate: true };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);

      // 400/422 = payload inválido → sem retry
      if (res.status === 400 || res.status === 422) {
        throw new Error(`nimrod-session: payload inválido (${res.status}): ${text}`);
      }

      // 5xx → retry
      if (res.status >= 500 && attempt < 2) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`nimrod-session | HTTP ${res.status}, retry em ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
        return this.#post(path, payload, attempt + 1);
      }

      throw new Error(`nimrod-session: HTTP ${res.status}: ${text}`);
    }

    const ct = res.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? res.json() : { ok: true };
  }

  // ─── API pública ─────────────────────────────────────────────────────────────

  /**
   * Envia um evento de recurso para a sessão ativa.
   *
   * @param {object} payload
   * @param {string}  payload.playerId       - UUID do jogador no Nimrod
   * @param {string}  payload.actorName      - Nome do personagem
   * @param {string}  payload.resourceType   - 'gold'|'xp'|'potion'|'spell_slot'|'item'|'hp'|'custom'
   * @param {number}  payload.delta          - Valor da mudança (positivo = ganho, negativo = gasto)
   * @param {number}  [payload.valueBefore]  - Valor antes da mudança
   * @param {number}  [payload.valueAfter]   - Valor após a mudança
   * @param {object}  [payload.deltaMeta]    - Dados extras ({ slot_level, item_name, … })
   * @param {string}  [payload.description]  - Descrição do evento
   * @param {string}  [payload.foundryEventId] - ID idempotente (gerado automaticamente se omitido)
   * @param {string}  [payload.occurredAt]   - ISO timestamp (default: agora)
   *
   * @returns {Promise<object|null>} Resposta do backend, ou null se sync desativado
   */
  static async sendEvent(payload) {
    if (!this.enabled) return null;

    // Garante foundryEventId único e idempotente
    const eventId = payload.foundryEventId
      ?? `fvtt-${game.world.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Deduplicação local (evita reenvio em reconexões dentro da mesma sessão)
    if (this.#sent.has(eventId)) {
      console.log(`nimrod-session | Evento ${eventId} já enviado nesta sessão — ignorado.`);
      return null;
    }

    const body = {
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
      source:         "foundry",
    };

    try {
      const result = await this.#post(
        `/api/sessions/${this.activeSessionId}/events`,
        body,
      );
      // Só marca como enviado após sucesso
      this.#sent.add(eventId);
      console.log(`%cnimrod-session | ✓ Evento enviado: ${payload.resourceType} ${payload.delta > 0 ? "+" : ""}${payload.delta} para ${payload.actorName}`, "color:#4a9a6a");
      return result;
    } catch (err) {
      console.warn("nimrod-session | Falha ao enviar evento (non-critical):", err.message);
      return null;
    }
  }

  /**
   * Testa a conexão com o backend Nimrod.
   * Uso: await NimrodSession.sync.ping()
   */
  static async ping() {
    if (!this.baseUrl) {
      console.warn("nimrod-session | URL não configurada.");
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`, {
        headers: this.#headers,
      });
      const ok = res.ok || res.status === 403; // 403 = autenticado mas sem acesso
      console.log(
        `%cnimrod-session | Ping: ${ok ? "✅ OK" : "❌ FALHOU"} (${res.status})`,
        ok ? "color:#4a9a6a" : "color:#c04040",
      );
      return ok;
    } catch (err) {
      console.error("nimrod-session | Ping falhou:", err.message);
      return false;
    }
  }

  /**
   * Exibe o status atual no console.
   * Uso: NimrodSession.sync.status()
   */
  static status() {
    console.group("%cnimrod-session | Status", "color:#c9a84c;font-weight:bold");
    console.log("Enabled:     ", this.enabled);
    console.log("URL:         ", this.baseUrl || "(não configurada)");
    console.log("Token:       ", this.token ? `***${this.token.slice(-4)}` : "(não configurado)");
    console.log("Sessão ativa:", this.activeSessionId || "(nenhuma)");
    console.log("Eventos enviados nesta sessão:", this.#sent.size);
    console.groupEnd();
    return {
      enabled:         this.enabled,
      url:             this.baseUrl,
      hasToken:        !!this.token,
      activeSessionId: this.activeSessionId,
      sentCount:       this.#sent.size,
    };
  }

  /** Limpa o cache de eventos enviados (útil ao trocar de sessão ativa). */
  static clearSentCache() {
    const count = this.#sent.size;
    this.#sent.clear();
    console.log(`nimrod-session | Cache limpo (${count} entradas removidas).`);
  }
}
