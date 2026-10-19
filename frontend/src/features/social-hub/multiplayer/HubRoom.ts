import { tavernMap } from '../world/tavernMap';
import type { HubTransport, RoomState, RoomAdmission } from './protocol';
import { readSnapshot } from './protocol';
import type { Point } from '../world/isometric';

const messages: Record<string, string> = {
  CHARACTER_UNAVAILABLE: 'O personagem não está mais autorizado para esta sala. Atualize a seleção.',
  SESSION_REPLACED: 'Sua conta entrou na taverna em outra aba. Use Reconectar para retomar aqui.',
  SESSION_EXPIRED: 'A presença expirou. Reconecte para entrar novamente.',
  MAP_MISMATCH: 'O mapa mudou. Recarregue a página para entrar na sala.',
  ROOM_FULL: 'A taverna atingiu o limite de 32 personagens.',
  SERVICE_UNAVAILABLE: 'Não foi possível validar os personagens. Tente reconectar.',
  BLOCKED: 'Não há caminho livre até esse destino.',
  JOIN_RATE_LIMITED: 'Muitas trocas de personagem em sequência. Aguarde alguns segundos e reconecte à sala.',
};

/** Session over the existing authenticated socket. Never creates or owns a WebSocket. */
export class HubRoom {
  private state: RoomState = { status: 'offline', players: [], selfId: null, error: null };
  private readonly listeners = new Set<() => void>();
  private active = false;
  private connected = false;
  private requestId: string | null = null;
  private sessionId: string | null = null;
  private revision = -1;
  private stopObserving: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private joinedAt = 0;
  private lastPing = 0;
  private lastState = 0;
  private away = false;
  private direction: Point = { x: 0, y: 0 };

  constructor(private readonly transport: HubTransport, readonly characterId: string,
    private readonly now = Date.now, private readonly nonce = () => crypto.randomUUID(),
    private readonly admission: RoomAdmission = { blocked: false }) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: RoomState) { this.state = state; this.listeners.forEach(listener => listener()); }
  start() {
    if (this.active) return; this.active = true;
    this.stopObserving = this.transport.observe(this.receive);
    this.timer = setInterval(this.tick, 100);
    if (this.connected) this.join();
  }
  setConnected(connected: boolean) {
    this.connected = connected;
    if (!this.active) return;
    if (!connected) { this.sessionId = null; this.requestId = null; this.direction = { x: 0, y: 0 };
      this.publish({ status: 'offline', players: [], selfId: null, error: null }); }
    else if (this.state.status === 'offline') this.join();
  }
  retry = () => { if (this.active && this.connected) { this.admission.blocked = false; this.cancel(); this.join(); } };
  private join() {
    if (this.admission.blocked) { this.fail(messages.SESSION_REPLACED); return; }
    this.requestId = this.nonce(); this.sessionId = null; this.revision = -1; this.joinedAt = this.now();
    this.publish({ status: 'joining', players: [], selfId: null, error: null });
    if (!this.transport.send({ type: 'HUB_JOIN', requestId: this.requestId, characterId: this.characterId,
      version: 1, mapId: tavernMap.id, mapVersion: tavernMap.version })) this.fail('Conexão indisponível. Tente reconectar.');
  }
  private cancel() {
    if (this.sessionId) this.send('HUB_LEAVE');
    if (this.requestId) this.transport.send({ type: 'HUB_CANCEL', requestId: this.requestId });
    this.sessionId = null; this.requestId = null; this.direction = { x: 0, y: 0 };
  }
  private send(type: string, fields: Record<string, unknown> = {}) {
    return !!this.sessionId && this.connected && this.transport.send({ type, sessionId: this.sessionId, ...fields });
  }
  move(target: Point) { this.direction = { x: 0, y: 0 }; return this.state.status === 'joined' && this.send('HUB_MOVE', { target }); }
  input(direction: Point) {
    if (this.state.status !== 'joined') return;
    this.direction = { ...direction };
    if (direction.x || direction.y) { if (this.state.status === 'joined') this.send('HUB_INPUT', { direction }); }
    else this.stopMoving();
  }
  stopMoving() { this.direction = { x: 0, y: 0 }; if (this.state.status === 'joined') this.send('HUB_STOP'); }
  setAway(away: boolean) { this.away = away; if (away) this.stopMoving(); if (this.state.status === 'joined') this.send('HUB_PING', { away }); }
  private fail(error: string) { this.cancel(); this.publish({ status: 'error', players: [], selfId: null, error }); }
  private tick = () => {
    const time = this.now();
    if (this.state.status === 'joining' && time - this.joinedAt > 8000) this.fail('A sala não respondeu. Verifique a conexão e tente reconectar.');
    if (this.state.status !== 'joined') return;
    if (time - this.lastState > 6000) { this.fail('A sincronização foi interrompida. Reconecte para continuar.'); return; }
    if (this.direction.x || this.direction.y) this.send('HUB_INPUT', { direction: this.direction });
    if (time - this.lastPing >= 5000) { this.lastPing = time; this.send('HUB_PING', { away: this.away }); }
  };
  private receive = (message: unknown) => {
    if (!this.active || !this.connected || !message || typeof message !== 'object') return;
    const { type, data } = message as { type?: unknown; data?: Record<string, unknown> };
    if (!data || typeof data !== 'object') return;
    if (type === 'HUB_ERROR') {
      if (!(data.requestId && data.requestId === this.requestId) && !(data.sessionId && data.sessionId === this.sessionId)) return;
      if (data.code === 'BLOCKED' || data.code === 'RATE_LIMITED' || data.code === 'INVALID_MESSAGE') {
        this.publish({ ...this.state, error: messages[String(data.code)] ?? 'A solicitação foi recusada pelo servidor.' }); return;
      }
      if (data.code === 'SESSION_REPLACED') this.admission.blocked = true;
      this.fail(messages[String(data.code)] ?? 'Não foi possível entrar na sala. Tente reconectar.'); return;
    }
    if (type !== 'HUB_JOINED' && type !== 'HUB_STATE') return;
    const snapshot = readSnapshot(data);
    if (!snapshot) return;
    if (type === 'HUB_JOINED') {
      if (this.state.status !== 'joining' || data.requestId !== this.requestId || data.selfId !== this.characterId
        || typeof data.sessionId !== 'string' || !data.sessionId) return;
      this.sessionId = data.sessionId;
    } else if (this.state.status !== 'joined' || snapshot.revision <= this.revision) return;
    if (!snapshot.players.some(player => player.id === this.characterId)) { this.fail('Sua presença foi encerrada. Reconecte para continuar.'); return; }
    this.revision = snapshot.revision; this.lastState = this.now();
    this.publish({ status: 'joined', players: snapshot.players, selfId: this.characterId, error: null });
  };
  stop() {
    if (!this.active) return;
    this.active = false; this.cancel(); this.stopObserving?.(); this.stopObserving = null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.publish({ status: 'offline', players: [], selfId: null, error: null });
  }
}
