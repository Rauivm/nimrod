import { loadAvatarAtlas } from '../assets/avatarAtlas';
import type { AvatarAtlas } from '../assets/avatarAtlas';
import { resolveAppearance } from '../appearance/resolveAppearance';
import type { AvatarAppearance } from '../appearance/resolveAppearance';
import { RoomMotion } from '../multiplayer/RoomMotion';
import type { RoomPlayer } from '../multiplayer/protocol';
import type { HubRoom } from '../multiplayer/HubRoom';
import type { TavernEnvironment } from './TavernEnvironment';
import { ExplorerMarker } from './ExplorerMarker';

interface Entry { player: RoomPlayer; key: string; active: boolean; failed?: boolean; marker?: ExplorerMarker; motion: RoomMotion; release: () => void }
interface Cached { refs: number; promise: Promise<AvatarAtlas>; controller: AbortController }

/** Scene-owned, reference-counted class atlases. No texture ownership crosses scenes. */
export class RoomAvatars {
  private readonly entries = new Map<string, Entry>();
  private readonly cache = new Map<string, Cached>();
  private readonly unsubscribe: () => void;
  private destroyed = false;
  private time = 0;
  constructor(private readonly environment: TavernEnvironment, private readonly room: HubRoom,
    private readonly ownAtlas: AvatarAtlas, private readonly ownPreset: string,
    private readonly wake: () => void, private readonly notice: (message: string) => void,
    private readonly canvas: HTMLCanvasElement) {
    environment.labels.sortableChildren = true;
    this.unsubscribe = room.subscribe(this.sync); this.sync();
  }
  private acquire(appearance: AvatarAppearance) {
    if (appearance.preset.id === this.ownPreset) return { promise: Promise.resolve(this.ownAtlas), release: () => {} };
    const key = appearance.preset.id;
    let cached = this.cache.get(key);
    if (!cached) {
      const controller = new AbortController();
      cached = { refs: 0, promise: loadAvatarAtlas(appearance, controller.signal), controller }; this.cache.set(key, cached);
    }
    const item = cached; item.refs++;
    return { promise: item.promise, release: () => {
      if (--item.refs === 0) {
        if (this.cache.get(key) === item) this.cache.delete(key);
        item.controller.abort();
        void item.promise.then(atlas => atlas.destroy(), () => {});
      }
    } };
  }
  private remove(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    this.entries.delete(id); entry.active = false;
    entry.marker?.root.destroy({ children: true }); entry.marker?.nameplate.destroy({ children: true }); entry.marker?.destination.destroy();
    entry.release();
    if (entry.failed && !this.destroyed && ![...this.entries.values()].some(e => e.failed)) this.notice('');
  }
  private sync = () => {
    if (this.destroyed) return;
    const state = this.room.getSnapshot();
    const players = state.status === 'joined' ? state.players.filter(p => p.id !== state.selfId) : [];
    for (const id of this.entries.keys()) if (!players.some(p => p.id === id)) this.remove(id);
    for (const player of players) {
      const appearance = resolveAppearance(player.classe), key = JSON.stringify([appearance.preset.id, player.name, player.level]);
      let entry = this.entries.get(player.id);
      if (entry && entry.key !== key) { this.remove(player.id); entry = undefined; }
      if (entry) { entry.player = player; entry.motion.accept(player, this.time); continue; }
      const asset = this.acquire(appearance);
      const created: Entry = { player, key, active: true, motion: new RoomMotion(player), release: asset.release };
      created.motion.accept(player, this.time); this.entries.set(player.id, created);
      void asset.promise.then(atlas => {
        if (!created.active || this.destroyed) return;
        const p = created.player;
        const marker = new ExplorerMarker({ id: p.id, name: p.name, level: p.level, classe: p.classe,
          race: null, foundryActorId: null, portraitImg: null, tokenImg: null, lastSyncedAt: null }, atlas, false);
        created.marker = marker; marker.update(created.motion, this.time, true);
        this.environment.world.addChild(marker.root); this.environment.labels.addChild(marker.nameplate);
        this.canvas.dataset.remoteAvatars = String([...this.entries.values()].filter(e => e.marker).length);
        this.wake();
      }).catch(() => { if (created.active && !this.destroyed) { created.failed = true; this.notice('Um visual de personagem não carregou. Reconecte à sala para tentar novamente.'); } });
    }
    this.canvas.dataset.remoteAvatars = String([...this.entries.values()].filter(e => e.marker).length);
    this.wake();
  };
  get active() { return [...this.entries.values()].some(entry => entry.motion.active); }
  update(seconds: number, time: number, reduced: boolean) {
    this.time = time;
    for (const entry of this.entries.values()) {
      entry.motion.update(seconds, time); entry.marker?.update(entry.motion, time, reduced, seconds);
    }
  }
  destroy() {
    if (this.destroyed) return; this.destroyed = true; this.unsubscribe();
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}
