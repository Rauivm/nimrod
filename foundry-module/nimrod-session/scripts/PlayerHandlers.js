/**
 * scripts/PlayerHandlers.js
 *
 * Registro de presença — única fonte de verdade para: conectou,
 * desconectou, reconectou, heartbeat, ficou ocioso, voltou do ocioso.
 *
 * Modelo: AUTO-RELATO, não observação pelo GM.
 *   Versões anteriores tinham o cliente do GM observando TODOS os
 *   jogadores via Hooks.on('userConnected', ...) — isso funcionava, mas
 *   dependia do GM estar sempre online e, se registrado sem filtro,
 *   faria N clientes conectados relatarem o MESMO evento de conexão
 *   (Foundry dispara userConnected em todos os clientes já conectados
 *   quando alguém entra/sai, não só no GM).
 *
 *   Aqui, cada cliente relata SOMENTE sobre si mesmo (game.user). Isso
 *   elimina duplicidade por construção — nenhum filtro de origem por
 *   userId é necessário, porque cada cliente só fala de si.
 *
 * Eventos emitidos (todos via SessionSync.sendSessionEvent — mesmo
 * pipeline de qualquer outro evento estrutural do nimrod-session):
 *
 *   PLAYER_CONNECTED     → uma vez, no carregamento da página (hook ready)
 *   PLAYER_DISCONNECTED  → fechamento de aba/navegador (beforeunload) OU
 *                           queda do socket (game.socket 'disconnect')
 *   PLAYER_RECONNECTED   → socket.io reconecta sozinho após queda
 *                           (game.socket 'reconnect') — cobre wifi
 *                           instável, notebook suspenso, etc., sem exigir
 *                           reload da página
 *   PLAYER_HEARTBEAT     → periódico (ver setting heartbeatIntervalSec),
 *                           mantém last_seen_at fresco mesmo sem outra
 *                           atividade — cobre o caso de crash abrupto
 *                           (sem beforeunload) sendo detectável por
 *                           ausência de heartbeats recentes
 *   PLAYER_IDLE          → sem input do usuário por N minutos (configurável)
 *   PLAYER_ACTIVE        → atividade retomada após um PLAYER_IDLE
 *
 * Nenhum destes eventos inclui texto narrativo — apenas fatos e dados
 * brutos (payload). Interpretação é responsabilidade de um módulo futuro.
 */

import { SessionSync } from './SessionSync.js';

const MODULE_ID = 'nimrod-session';

export const PlayerEventType = Object.freeze({
  CONNECTED:    'PLAYER_CONNECTED',
  DISCONNECTED: 'PLAYER_DISCONNECTED',
  RECONNECTED:  'PLAYER_RECONNECTED',
  HEARTBEAT:    'PLAYER_HEARTBEAT',
  IDLE:         'PLAYER_IDLE',
  ACTIVE:       'PLAYER_ACTIVE',
});

export class PlayerHandlers {

  static #heartbeatTimer = null;
  static #idleTimer      = null;
  static #isIdle         = false;
  static #registered     = false;

  // ─── Settings ────────────────────────────────────────────────────────────

  static registerSettings() {
    game.settings.register(MODULE_ID, 'heartbeatIntervalSec', {
      name:    'Intervalo de Heartbeat (segundos)',
      hint:    'De quanto em quanto tempo cada cliente confirma que ainda está online.',
      scope:   'world', config: true, type: Number, default: 60,
    });
    game.settings.register(MODULE_ID, 'idleTimeoutMin', {
      name:    'Tempo até considerar Ocioso (minutos)',
      hint:    'Sem nenhuma interação (mouse/teclado) por esse tempo, o jogador é marcado como ocioso.',
      scope:   'world', config: true, type: Number, default: 5,
    });
  }

  // ─── Identidade do cliente atual ──────────────────────────────────────────

  /**
   * Monta o fragmento de identidade do usuário ATUAL (game.user) para
   * anexar a qualquer evento de presença. Prioriza actorId (personagem
   * assinado ao usuário) — muitos GMs não têm personagem, por isso
   * foundryName é sempre incluído como fallback de resolução no backend.
   */
  static #selfIdentity() {
    const character = game.user.character ?? null;
    return {
      actorId:     character?.id   ?? null,
      actorName:   character?.name ?? null,
      foundryName: game.user.name,
    };
  }

  static async #emit(eventType, extraPayload = {}) {
    const identity = this.#selfIdentity();
    return SessionSync.sendSessionEvent({
      eventType,
      ...identity,
      payload: {
        foundry_user_id: game.user.id,
        is_gm:           game.user.isGM,
        ...extraPayload,
      },
    });
  }

  // ─── Registro (chamado uma vez, quando a sessão é vinculada) ─────────────

  static register() {
    if (this.#registered) return;
    this.#registered = true;

    this.#reportConnected();
    this.#registerSocketLifecycle();
    this.#registerDisconnectOnUnload();
    this.#startHeartbeat();
    this.#registerIdleDetection();

    console.log('%cnimrod-session | PlayerHandlers registrado (auto-relato)', 'color:#4a9a6a');
  }

  /** Desfaz timers/listeners — chamado quando a sessão é encerrada. */
  static unregister() {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#idleTimer)      clearTimeout(this.#idleTimer);
    this.#heartbeatTimer = null;
    this.#idleTimer      = null;
    this.#isIdle         = false;
    this.#registered     = false;
  }

  // ─── Conexão inicial ──────────────────────────────────────────────────────

  static async #reportConnected() {
    await this.#emit(PlayerEventType.CONNECTED);
  }

  // ─── Ciclo de vida do socket (queda/retomada sem reload de página) ───────

  static #registerSocketLifecycle() {
    if (!game.socket) return;

    game.socket.on('disconnect', () => {
      // Best-effort: a conexão HTTP para o Nimrod pode ou não estar
      // disponível no momento exato da queda do socket Foundry — tenta
      // mesmo assim, sem bloquear.
      this.#emit(PlayerEventType.DISCONNECTED, { reason: 'socket_disconnect' });
    });

    game.socket.on('reconnect', () => {
      this.#emit(PlayerEventType.RECONNECTED, { reason: 'socket_reconnect' });
    });
  }

  // ─── Fechamento de aba/navegador ──────────────────────────────────────────

  static #registerDisconnectOnUnload() {
    const handler = () => {
      // sendSessionEvent → fetch com keepalive é responsabilidade do
      // SessionSync/#post; navegador pode ainda assim descartar a
      // requisição em fechamentos abruptos — é best-effort por natureza.
      this.#emit(PlayerEventType.DISCONNECTED, { reason: 'page_unload' });
    };
    window.addEventListener('beforeunload', handler, { once: true });
    window.addEventListener('pagehide',     handler, { once: true });
  }

  // ─── Heartbeat periódico ──────────────────────────────────────────────────

  static #startHeartbeat() {
    const intervalSec = game.settings.get(MODULE_ID, 'heartbeatIntervalSec') || 60;
    this.#heartbeatTimer = setInterval(() => {
      this.#emit(PlayerEventType.HEARTBEAT);
    }, intervalSec * 1000);
  }

  // ─── Detecção de ociosidade ────────────────────────────────────────────────

  static #registerIdleDetection() {
    const timeoutMin = game.settings.get(MODULE_ID, 'idleTimeoutMin') || 5;
    const timeoutMs  = timeoutMin * 60 * 1000;

    const resetIdleTimer = () => {
      if (this.#isIdle) {
        this.#isIdle = false;
        this.#emit(PlayerEventType.ACTIVE);
      }
      if (this.#idleTimer) clearTimeout(this.#idleTimer);
      this.#idleTimer = setTimeout(() => {
        this.#isIdle = true;
        this.#emit(PlayerEventType.IDLE, { idle_after_seconds: timeoutMin * 60 });
      }, timeoutMs);
    };

    // Qualquer input do usuário reseta o timer — passive:true por
    // performance (não precisamos bloquear o evento nativo).
    ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    resetIdleTimer(); // arma o primeiro timer
  }
}
