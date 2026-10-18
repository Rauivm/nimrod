import type { Point } from './isometric';

interface Floorplan {
  columns: number;
  rows: number;
  props: readonly { position: Point; footprint: { width: number; height: number } }[];
}
interface Obstacle { left: number; right: number; top: number; bottom: number }

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Local navigation only. The future multiplayer server must own its own validation. */
export class Navigation {
  readonly step = 0.25;
  readonly radius = 0.18;
  private readonly width: number;
  private readonly height: number;
  private readonly obstacles: Obstacle[];
  private readonly cells: boolean[];

  constructor(private readonly map: Floorplan) {
    this.width = Math.ceil(map.columns / this.step);
    this.height = Math.ceil(map.rows / this.step);
    this.obstacles = map.props.map(({ position, footprint }) => ({
      left: position.x - footprint.width / 2 - this.radius,
      right: position.x + footprint.width / 2 + this.radius,
      top: position.y - footprint.height / 2 - this.radius,
      bottom: position.y + footprint.height / 2 + this.radius,
    }));
    this.cells = Array.from({ length: this.width * this.height }, (_, id) => this.isWalkable(this.center(id)));
  }

  isWalkable(p: Point): boolean {
    return finite(p) && p.x >= this.radius && p.y >= this.radius
      && p.x <= this.map.columns - this.radius && p.y <= this.map.rows - this.radius
      && !this.obstacles.some(o => p.x >= o.left && p.x <= o.right && p.y >= o.top && p.y <= o.bottom);
  }

  canTraverse(from: Point, to: Point): boolean {
    if (!this.isWalkable(from) || !this.isWalkable(to)) return false;
    // Segment/slab intersection prevents tunneling and diagonal corner cutting.
    return !this.obstacles.some(o => {
      let enter = 0, leave = 1;
      for (const [start, delta, low, high] of [
        [from.x, to.x - from.x, o.left, o.right],
        [from.y, to.y - from.y, o.top, o.bottom],
      ]) {
        if (Math.abs(delta) < 1e-10) {
          if (start < low || start > high) return false;
        } else {
          const a = (low - start) / delta, b = (high - start) / delta;
          enter = Math.max(enter, Math.min(a, b));
          leave = Math.min(leave, Math.max(a, b));
          if (enter > leave) return false;
        }
      }
      return enter <= leave;
    });
  }

  private center(id: number): Point {
    return { x: (id % this.width + 0.5) * this.step, y: (Math.floor(id / this.width) + 0.5) * this.step };
  }

  private anchor(p: Point): number | undefined {
    // Choose a nearby cell connected to the exact point, never jump through a prop.
    const candidates: number[] = [];
    const x = Math.floor(p.x / this.step), y = Math.floor(p.y / this.step);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy, id = ny * this.width + nx;
      if (nx >= 0 && ny >= 0 && nx < this.width && ny < this.height && this.cells[id]) candidates.push(id);
    }
    candidates.sort((a, b) => distance(this.center(a), p) - distance(this.center(b), p));
    return candidates.find(id => this.canTraverse(p, this.center(id)));
  }

  findPath(from: Point, to: Point): Point[] | null {
    if (!this.isWalkable(from) || !this.isWalkable(to)) return null;
    if (this.canTraverse(from, to)) return [{ ...to }];
    const start = this.anchor(from), goal = this.anchor(to);
    if (start === undefined || goal === undefined) return null;
    const open = new Set([start]);
    const scores = new Map([[start, 0]]), parents = new Map<number, number>();
    const closed = new Set<number>();
    while (open.size) {
      let current = -1, best = Infinity;
      for (const id of open) {
        const score = scores.get(id)! + distance(this.center(id), this.center(goal));
        if (score < best) { best = score; current = id; }
      }
      if (current === goal) {
        const raw: Point[] = [{ ...to }];
        let at = goal;
        while (true) {
          raw.unshift(this.center(at));
          if (at === start) break;
          at = parents.get(at)!;
        }
        const result: Point[] = [];
        let previous = from, next = 0;
        while (next < raw.length) {
          let furthest = next;
          for (let index = next + 1; index < raw.length; index++) {
            if (this.canTraverse(previous, raw[index])) furthest = index;
          }
          result.push(raw[furthest]); previous = raw[furthest]; next = furthest + 1;
        }
        return result;
      }
      open.delete(current); closed.add(current);
      const x = current % this.width, y = Math.floor(current / this.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy, id = ny * this.width + nx;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height || !this.cells[id] || closed.has(id)) continue;
        if (!this.canTraverse(this.center(current), this.center(id))) continue;
        const score = scores.get(current)! + distance(this.center(current), this.center(id));
        if (score < (scores.get(id) ?? Infinity)) {
          scores.set(id, score); parents.set(id, current); open.add(id);
        }
      }
    }
    return null;
  }
}
