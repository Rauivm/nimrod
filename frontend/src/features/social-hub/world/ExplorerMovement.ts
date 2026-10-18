import type { Point } from './isometric';
import type { Navigation } from './Navigation';

/** Pure movement state, independent from Pixi, keyboard, React and identity. */
export class ExplorerMovement {
  position: Point;
  direction: Point = { x: 0, y: 1 };
  moving = false;
  private path: Point[] = [];
  private input: Point = { x: 0, y: 0 };
  readonly speed = 2.8;

  constructor(readonly navigation: Navigation, spawn: Point) {
    if (!navigation.isWalkable(spawn)) throw new Error('Explorer spawn is blocked');
    this.position = { ...spawn };
  }

  walkTo(target: Point): boolean {
    const path = this.navigation.findPath(this.position, target);
    if (!path) return false;
    this.input = { x: 0, y: 0 }; this.path = path;
    return true;
  }

  setInput(input: Point) {
    this.input = { ...input };
    if (input.x || input.y) this.path = [];
  }

  stop() { this.path = []; this.input = { x: 0, y: 0 }; this.moving = false; }
  get pending() { return this.path.length > 0; }

  update(seconds: number) {
    // Bound elapsed time, then subdivide keyboard motion to slide along furniture/walls.
    let remaining = this.speed * Math.min(0.05, Math.max(0, seconds));
    const before = { ...this.position };
    if (this.input.x || this.input.y) {
      const length = Math.hypot(this.input.x, this.input.y);
      const dx = this.input.x / length, dy = this.input.y / length;
      while (remaining > 1e-8) {
        const step = Math.min(0.04, remaining), p = this.position;
        const target = { x: p.x + dx * step, y: p.y + dy * step };
        if (this.navigation.canTraverse(p, target)) this.position = target;
        else {
          const x = { x: p.x + dx * step, y: p.y };
          if (this.navigation.canTraverse(p, x)) this.position = x;
          const y = { x: this.position.x, y: this.position.y + dy * step };
          if (this.navigation.canTraverse(this.position, y)) this.position = y;
        }
        remaining -= step;
      }
    } else while (remaining > 1e-8 && this.path.length) {
      const target = this.path[0], p = this.position;
      const distance = Math.hypot(target.x - p.x, target.y - p.y);
      if (distance < 1e-8) { this.path.shift(); continue; }
      const step = Math.min(remaining, distance);
      const next = { x: p.x + (target.x - p.x) / distance * step, y: p.y + (target.y - p.y) / distance * step };
      if (!this.navigation.canTraverse(p, next)) { this.stop(); break; }
      this.position = next; remaining -= step;
      if (step === distance) this.path.shift();
    }
    const dx = this.position.x - before.x, dy = this.position.y - before.y;
    this.moving = Math.hypot(dx, dy) > 1e-8 && (this.path.length > 0 || this.input.x !== 0 || this.input.y !== 0);
    if (this.moving) this.direction = { x: dx, y: dy };
  }
}
