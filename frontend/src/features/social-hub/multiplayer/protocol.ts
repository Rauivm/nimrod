import { tavernMap } from '../world/tavernMap';
import { Navigation } from '../world/Navigation';
import type { Point } from '../world/isometric';

export interface RoomPlayer {
  id: string; name: string; level: number | null; classe: string | null;
  position: Point; direction: Point; moving: boolean; presence: 'online' | 'away';
}
export interface RoomState {
  status: 'offline' | 'joining' | 'joined' | 'error'; players: RoomPlayer[]; selfId: string | null; error: string | null;
}
export interface HubTransport {
  send(message: Record<string, unknown>): boolean;
  observe(listener: (message: unknown) => void): () => void;
}
// Account/page-local admission choice, not an authentication credential.
export interface RoomAdmission { blocked: boolean }
const navigation = new Navigation(tavernMap);
const point = (v: unknown): v is Point => !!v && typeof v === 'object'
  && typeof (v as Point).x === 'number' && Number.isFinite((v as Point).x)
  && typeof (v as Point).y === 'number' && Number.isFinite((v as Point).y);
export function readSnapshot(value: unknown): { players: RoomPlayer[]; revision: number } | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.mapId !== tavernMap.id || data.mapVersion !== tavernMap.version
    || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0 || !Array.isArray(data.players) || data.players.length > 32) return null;
  const ids = new Set<string>(), players: RoomPlayer[] = [];
  for (const v of data.players) {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id || ids.has(v.id)
      || typeof v.name !== 'string' || !v.name || v.name.length > 150
      || !(v.level === null || (Number.isInteger(v.level) && v.level > 0))
      || !(v.classe === null || (typeof v.classe === 'string' && v.classe.length <= 500))
      || !point(v.position) || !navigation.isWalkable(v.position) || !point(v.direction)
      || typeof v.moving !== 'boolean' || !['online','away'].includes(v.presence)) return null;
    ids.add(v.id); players.push({ id: v.id, name: v.name, level: v.level, classe: v.classe,
      position: { ...v.position }, direction: { ...v.direction }, moving: v.moving, presence: v.presence });
  }
  return { players, revision: data.revision as number };
}
