import { randomUUID } from 'node:crypto';
import { Navigation } from './world/Navigation.js';
import { ExplorerMovement } from './world/ExplorerMovement.js';
import { tavernMap as map } from './world/tavernMap.js';

const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const point = p => p && typeof p === 'object' && Object.keys(p).length === 2
  && typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y);
const keys = (msg, allowed) => Object.keys(msg).every(key => allowed.includes(key));
const requestId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const fields = row => ({ name: String(row.name).slice(0,150),
  level: Number.isInteger(row.level) && row.level > 0 ? row.level : null,
  classe: typeof row.classe === 'string' ? row.classe.slice(0,500) : null });
const wire = p => ({ id: p.id, name: p.name, level: p.level, classe: p.classe,
  position: { ...p.motion.position }, direction: { ...p.motion.direction }, moving: p.motion.moving,
  presence: p.away ? 'away' : 'online' });

/** One process owns this ephemeral room. Never accepts coordinates as a position. */
export class SocialHubRoom {
  constructor({ loadCharacter, revalidate, now = Date.now, maxPlayers = 32, validationTimeoutMs = 3000 }) {
    this.loadCharacter = loadCharacter; this.revalidate = revalidate; this.now = now; this.maxPlayers = maxPlayers;
    this.navigation = new Navigation(map); this.connections = new Map(); this.players = new Map();
    this.revision = 0; this.timer = null; this.lastTick = now(); this.lastSync = 0; this.lastValidation = 0;
    this.validating = false; this.destroyed = false;
    this.dirty = false;
    this.lookups = 0; this.validationTimeoutMs = validationTimeoutMs; this.validationTimer = null; this.validationUnavailable = false;
  }

  attach(socket, user) {
    const record = { socket, userId: user.id, generation: 0, pending: null, player: null, buckets: new Map(), violations: 0, lastError: -Infinity };
    this.connections.set(socket, record);
    return () => this.detach(socket);
  }

  send(record, type, data) {
    const socket = record.socket;
    if (socket.readyState !== 1) return false;
    if (socket.bufferedAmount > 131072) {
      socket.close(1013, 'Slow consumer'); this.detach(socket); return false;
    }
    try { socket.send(JSON.stringify({ type, data, ts: this.now() })); return true; }
    catch { this.detach(socket); return false; }
  }

  error(record, code, id = record.pending) {
    this.send(record, 'HUB_ERROR', { code, requestId: id, sessionId: record.player?.sessionId ?? null });
  }

  allow(record, key, rate, burst = rate) {
    const time = this.now();
    const bucket = record.buckets.get(key) ?? { tokens: burst, time };
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, time - bucket.time) * rate / 1000); bucket.time = time;
    record.buckets.set(key, bucket);
    if (bucket.tokens >= 1) { bucket.tokens--; return true; }
    if (time - record.lastError >= 1000) { record.lastError = time; this.error(record, 'RATE_LIMITED'); }
    if (++record.violations >= 100) { record.socket.close(1008, 'Rate limit'); this.detach(record.socket); }
    return false;
  }

  // Returns true only for this namespace, leaving the legacy tavern protocol alone.
  accept(socket, raw, binary = false) {
    const record = this.connections.get(socket);
    if (!record || this.destroyed) return false;
    if (!this.allow(record, 'all', 40, 50)) return true;
    if (binary) return true;
    if (Buffer.byteLength(raw) > 2048) { this.error(record, 'MESSAGE_TOO_LARGE'); return true; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return true; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return true;
    if (typeof msg.type !== 'string' || !msg.type.startsWith('HUB_')) return false;
    if (msg.type === 'HUB_JOIN') {
      if (!keys(msg, ['type','requestId','characterId','mapId','mapVersion','version']) || !requestId(msg.requestId) || !uuid(msg.characterId)) this.error(record, 'INVALID_MESSAGE', msg.requestId);
      else if (msg.version !== 1 || msg.mapId !== map.id || msg.mapVersion !== map.version) this.error(record, 'MAP_MISMATCH', msg.requestId);
      else if (this.allow(record, 'join', 2, 5)) void this.join(record, msg);
      else this.error(record, 'JOIN_RATE_LIMITED', msg.requestId);
      return true;
    }
    if (msg.type === 'HUB_CANCEL') {
      if (keys(msg, ['type','requestId']) && requestId(msg.requestId)) {
        if (record.pending === msg.requestId) { record.generation++; record.pending = null; }
        if (record.player?.requestId === msg.requestId) this.leave(record);
      }
      return true;
    }
    const p = record.player;
    if (!p || msg.sessionId !== p.sessionId) return true;
    if (msg.type === 'HUB_LEAVE' && keys(msg, ['type','sessionId'])) { this.leave(record); return true; }
    if (msg.type === 'HUB_MOVE' && keys(msg, ['type','sessionId','target']) && point(msg.target)) {
      if (this.allow(record, 'move', 4, 4)) {
        if (!p.motion.walkTo(msg.target)) this.error(record, 'BLOCKED');
        else { p.inputUntil = 0; p.lastSeen = this.now(); }
      }
    } else if (msg.type === 'HUB_INPUT' && keys(msg, ['type','sessionId','direction']) && point(msg.direction)
      && [msg.direction.x, msg.direction.y].every(n => Number.isInteger(n) && Math.abs(n) <= 2)) {
      if (this.allow(record, 'input', 15, 18)) {
        p.motion.setInput(msg.direction); p.inputUntil = this.now() + 400; p.lastSeen = this.now();
      }
    } else if (msg.type === 'HUB_STOP' && keys(msg, ['type','sessionId'])) {
      p.motion.stop(); p.inputUntil = 0; p.lastSeen = this.now(); this.dirty = true;
    } else if (msg.type === 'HUB_PING' && keys(msg, ['type','sessionId','away']) && typeof msg.away === 'boolean') {
      if (this.allow(record, 'ping', 2, 3)) {
        p.lastSeen = this.now(); const changed = p.away !== msg.away; p.away = msg.away;
        if (p.away) { p.motion.stop(); p.inputUntil = 0; }
        if (changed) this.publish();
      }
    } else this.error(record, 'INVALID_MESSAGE');
    return true;
  }

  async join(record, msg) {
    const generation = ++record.generation; record.pending = msg.requestId;
    // One in-flight lookup per socket, eight for the whole room. A newer selection
    // replaces only the queued intent; cancelled SQL cannot fan out more queries.
    if (record.lookup) { record.nextJoin = msg; return; }
    if (this.lookups >= 8 || this.validationUnavailable) { this.error(record, 'SERVICE_UNAVAILABLE', msg.requestId); record.pending = null; return; }
    this.lookups++; record.lookup = true;
    try { await this.completeJoin(record, msg, generation); }
    finally {
      this.lookups--; record.lookup = false; const next = record.nextJoin; record.nextJoin = null;
      if (next && record.pending === next.requestId && this.connections.get(record.socket) === record) void this.join(record, next);
    }
  }

  async completeJoin(record, msg, generation) {
    let character;
    try { character = await this.loadCharacter(msg.characterId, record.userId); }
    catch { if (record.generation === generation && this.connections.has(record.socket)) this.error(record, 'SERVICE_UNAVAILABLE', msg.requestId); return; }
    if (this.destroyed || record.generation !== generation || this.connections.get(record.socket) !== record || record.socket.readyState !== 1) return;
    record.pending = null;
    if (!character) { this.error(record, 'CHARACTER_UNAVAILABLE', msg.requestId); return; }
    const previous = [...this.players.values()].filter(p => p.userId === record.userId || p.id === character.id);
    if (this.players.size - previous.length >= this.maxPlayers) { this.error(record, 'ROOM_FULL', msg.requestId); return; }
    for (const p of previous) { this.error(p.record, 'SESSION_REPLACED'); this.leave(p.record, false); }
    if (record.player) this.leave(record, false);
    const p = { id: character.id, userId: record.userId, record, requestId: msg.requestId, sessionId: randomUUID(),
      ...fields(character),
      motion: new ExplorerMovement(this.navigation, this.spawn()), lastSeen: this.now(), inputUntil: 0, away: false };
    record.player = p; this.players.set(p.id, p);
    this.send(record, 'HUB_JOINED', { requestId: msg.requestId, sessionId: p.sessionId, selfId: p.id,
      ...this.snapshot() });
    this.publish();
    if (!this.timer && this.players.size) { this.lastTick = this.now(); this.timer = setInterval(() => this.tick(), 50); this.timer.unref?.(); }
  }

  spawn() {
    const candidates = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) candidates.push({ x: map.spawn.x + dx * 0.5, y: map.spawn.y + dy * 0.5 });
    candidates.sort((a,b) => Math.hypot(a.x-map.spawn.x,a.y-map.spawn.y)-Math.hypot(b.x-map.spawn.x,b.y-map.spawn.y) || b.y-a.y);
    return candidates.find(point => this.navigation.isWalkable(point)
      && [...this.players.values()].every(p => Math.hypot(p.motion.position.x-point.x,p.motion.position.y-point.y)>=0.45)
      && this.navigation.findPath(map.spawn,point)) ?? map.spawn;
  }

  snapshot() { return { version: 1, mapId: map.id, mapVersion: map.version, revision: this.revision,
    serverTime: this.now(), players: [...this.players.values()].map(wire) }; }
  publish() {
    this.dirty = false; this.revision++; this.lastSync = this.now(); const data = this.snapshot();
    for (const p of [...this.players.values()]) this.send(p.record, 'HUB_STATE', data);
  }
  leave(record, publish = true) {
    const p = record.player; record.player = null;
    if (p && this.players.get(p.id) === p) { this.players.delete(p.id); if (publish) this.publish(); }
    if (!this.players.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  detach(socket) {
    const record = this.connections.get(socket); if (!record) return;
    record.generation++; record.pending = null; record.nextJoin = null; this.connections.delete(socket); this.leave(record);
  }
  tick() {
    const time = this.now(), dt = Math.min(0.05, Math.max(0, (time - this.lastTick) / 1000)); this.lastTick = time;
    let moved = false;
    for (const p of [...this.players.values()]) {
      if (p.record.socket.readyState !== 1) { this.detach(p.record.socket); continue; }
      if (time - p.lastSeen > 15000) { this.error(p.record, 'SESSION_EXPIRED'); this.leave(p.record); continue; }
      if (p.inputUntil && time > p.inputUntil) { p.motion.stop(); p.inputUntil = 0; this.dirty = true; }
      const before = p.motion.position, walking = p.motion.moving;
      p.motion.update(dt);
      moved ||= before.x !== p.motion.position.x || before.y !== p.motion.position.y || walking !== p.motion.moving;
    }
    this.dirty ||= moved;
    if (time - this.lastSync >= (this.dirty ? 100 : 1000)) this.publish();
    if (!this.validating && this.players.size && time - this.lastValidation >= 15000) void this.validateMembers();
  }
  async validateMembers() {
    this.validating = true; this.lastValidation = this.now(); const members = [...this.players.values()];
    this.validationTimer = setTimeout(() => {
      this.validationUnavailable = true;
      for (const p of members) if (this.players.get(p.id) === p) { this.error(p.record, 'SERVICE_UNAVAILABLE'); this.leave(p.record); }
    }, this.validationTimeoutMs);
    this.validationTimer.unref?.();
    try {
      const rows = await this.revalidate(members.map(p => p.id));
      for (const p of members) {
        if (this.players.get(p.id) !== p) continue;
        const row = rows.find(row => row.id === p.id && row.user_id === p.userId);
        if (!row) { this.error(p.record, 'CHARACTER_UNAVAILABLE'); this.leave(p.record); }
        else Object.assign(p, fields(row));
      }
      if (this.players.size) this.publish();
    } catch {
      for (const p of members) if (this.players.get(p.id) === p) { this.error(p.record, 'SERVICE_UNAVAILABLE'); this.leave(p.record); }
    } finally { clearTimeout(this.validationTimer); this.validationTimer = null; this.validating = false; this.validationUnavailable = false; }
  }
  destroy() {
    this.destroyed = true; if (this.timer) clearInterval(this.timer); this.timer = null;
    clearTimeout(this.validationTimer); this.validationTimer = null;
    for (const socket of [...this.connections.keys()]) this.detach(socket);
  }
}
