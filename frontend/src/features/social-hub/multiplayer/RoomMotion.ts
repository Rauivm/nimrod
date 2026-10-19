import { Navigation } from '../world/Navigation';
import { tavernMap } from '../world/tavernMap';
import type { RoomPlayer } from './protocol';
import type { Point } from '../world/isometric';

/** Visual smoothing only; targets always come from an accepted server snapshot. */
export class RoomMotion {
  position: Point;
  direction: Point;
  moving = false;
  private target: Point;
  private walking = false;
  private received = 0;
  constructor(player: RoomPlayer, private readonly navigation = new Navigation(tavernMap)) {
    this.position = { ...player.position }; this.target = { ...player.position }; this.direction = { ...player.direction };
  }
  accept(player: RoomPlayer, time: number, snap = false) {
    this.target = { ...player.position }; this.direction = { ...player.direction }; this.walking = player.moving; this.received = time;
    if (snap || Math.hypot(this.position.x - this.target.x, this.position.y - this.target.y) > 0.8
      || !this.navigation.canTraverse(this.position, this.target)) this.position = { ...this.target };
  }
  get active() { return this.walking || Math.hypot(this.position.x - this.target.x, this.position.y - this.target.y) > 0.001; }
  update(seconds: number, time: number) {
    const gap = Math.hypot(this.position.x - this.target.x, this.position.y - this.target.y);
    const factor = gap < 0.001 ? 1 : 1 - Math.exp(-24 * Math.max(0, Math.min(seconds, 0.1)));
    const next = { x: this.position.x + (this.target.x - this.position.x) * factor, y: this.position.y + (this.target.y - this.position.y) * factor };
    this.position = this.navigation.canTraverse(this.position, next) ? next : { ...this.target };
    if (Math.hypot(this.position.x - this.target.x, this.position.y - this.target.y) < 0.001) this.position = { ...this.target };
    this.moving = time - this.received < 0.75 && (this.walking || this.position.x !== this.target.x || this.position.y !== this.target.y);
    if (time - this.received >= 0.75) this.walking = false;
  }
}
