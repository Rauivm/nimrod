import { Container, Graphics } from 'pixi.js';
import { project } from '../world/isometric';
import type { Point } from '../world/isometric';
import { tavernMap as map } from '../world/tavernMap';

const point = (x: number, y: number, z = 0): Point => {
  const p = project({ x, y }, map);
  return { x: p.x, y: p.y - z };
};
const quad = (points: Point[]) => points.flatMap(p => [p.x, p.y]);

function tile(g: Graphics, x: number, y: number, width: number, height: number, color: number, alpha = 1) {
  g.poly(quad([point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)]))
    .fill({ color, alpha });
}

function beam(g: Graphics, x: number, y: number, height: number, size = 0.18) {
  const a = point(x, y), b = point(x + size, y), c = point(x + size, y + size), d = point(x, y + size);
  g.poly([a.x, a.y, b.x, b.y, b.x, b.y - height, a.x, a.y - height]).fill(0x49301b);
  g.poly([b.x, b.y, c.x, c.y, c.x, c.y - height, b.x, b.y - height]).fill(0x2b1c13);
  g.poly([a.x, a.y - height, b.x, b.y - height, c.x, c.y - height, d.x, d.y - height]).fill(0x796044);
}

export function drawArchitecture(floor: Container, walls: Container) {
  const g = new Graphics({ label: 'timber-floor' });
  floor.addChild(g);
  const a = point(0, 0), b = point(map.columns, 0), c = point(map.columns, map.rows), d = point(0, map.rows);
  g.ellipse(25, 360, 568, 260).fill({ color: 0x000000, alpha: 0.3 });
  g.poly([b.x, b.y, c.x, c.y, c.x, c.y + 28, b.x, b.y + 28]).fill(0x20150e);
  g.poly([d.x, d.y, c.x, c.y, c.x, c.y + 28, d.x, d.y + 28]).fill(0x382416);
  g.poly(quad([a, b, c, d])).fill(0x49301e);

  const palette = [0x6c482b, 0x754e30, 0x68442a, 0x805636, 0x714c2f, 0x634027];
  for (let x = 0; x < map.columns; x++) {
    for (let y = 0; y < map.rows * 3; y++) {
      const seed = (x * 113 + y * 37) % 97;
      tile(g, x + 0.012, y / 3 + 0.012, 0.976, 0.309, palette[seed % palette.length]);
      const from = point(x + 0.06, y / 3 + 0.09), to = point(x + 0.88, y / 3 + 0.09);
      g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: 0xb68a50, alpha: 0.16, width: 0.8 });
      const grain = point(x + 0.08 + (seed % 5) / 18, y / 3 + 0.22);
      g.moveTo(grain.x, grain.y).lineTo(grain.x + 19, grain.y + 9.5).stroke({ color: 0x22170e, alpha: 0.22, width: 0.7 });
      if (y % 3 === 0) {
        const nail = point(x + 0.06, y / 3 + 0.05);
        g.circle(nail.x, nail.y, 0.9).fill(0x37271b);
      }
    }
  }
  // Woven rugs remain separate floor geometry, beneath all depth-sorted furniture.
  const rugs = new Graphics({ label: 'woven-rugs' });
  floor.addChild(rugs);
  for (const center of [map.tables[2], map.tables[4]]) {
    const p = point(center.x, center.y);
    rugs.ellipse(p.x, p.y + 4, 102, 48).fill(0x482527).stroke({ color: 0x9e6e36, width: 3 });
    rugs.ellipse(p.x, p.y + 4, 94, 43).stroke({ color: 0x7c4337, width: 3 });
    rugs.ellipse(p.x, p.y + 4, 86, 38).stroke({ color: 0xb58c4a, alpha: 0.6, width: 1 });
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      const x = p.x + Math.cos(angle) * 78, y = p.y + 4 + Math.sin(angle) * 34;
      rugs.poly([x, y - 2, x + 3, y, x, y + 2, x - 3, y]).fill({ color: 0xb88e50, alpha: 0.55 });
    }
  }

  const w = new Graphics({ label: 'cutaway-walls' });
  walls.addChild(w);
  const h = map.wallHeight;
  w.poly([a.x, a.y, b.x, b.y, b.x, b.y - h, a.x, a.y - h]).fill(0x38291f);
  w.poly([a.x, a.y, d.x, d.y, d.x, d.y - h, a.x, a.y - h]).fill(0x2b241c);
  for (let i = 0; i < map.columns; i++) {
    const p = point(i, 0), next = point(i + 1, 0);
    w.poly([p.x, p.y - 10, next.x, next.y - 10, next.x, next.y - h + 9, p.x, p.y - h + 9])
      .fill(i % 2 ? 0x3e2d21 : 0x433124).stroke({ color: 0x201a15, width: 1 });
    for (let grain = 0; grain < 5; grain++) {
      const at = point(i + 0.1 + grain * 0.18, 0);
      const offset = (i * 13 + grain * 7) % 21;
      w.moveTo(at.x, at.y - 23 - offset).bezierCurveTo(at.x + 1.5, at.y - 55, at.x - 1, at.y - 80, at.x, at.y - h + 17)
        .stroke({ color: 0xb18a58, alpha: 0.14, width: 0.7 });
    }
  }
  for (let i = 0; i < map.rows; i++) {
    const p = point(0, i), next = point(0, i + 1);
    w.poly([p.x, p.y - 10, next.x, next.y - 10, next.x, next.y - h + 9, p.x, p.y - h + 9])
      .fill(i % 2 ? 0x33291f : 0x3a2d21).stroke({ color: 0x201a15, width: 1 });
    for (let grain = 0; grain < 5; grain++) {
      const at = point(0, i + 0.1 + grain * 0.18);
      w.moveTo(at.x, at.y - 23).bezierCurveTo(at.x - 1, at.y - 50, at.x + 2, at.y - 90, at.x, at.y - h + 17)
        .stroke({ color: 0xa8824c, alpha: 0.13, width: 0.7 });
    }
  }
  const stoneColors = [0x4b4437, 0x50493c, 0x423d33];
  for (const axis of ['x', 'y'] as const) {
    const length = axis === 'x' ? map.columns : map.rows;
    for (let i = 0; i < length; i++) {
      for (let row = 0; row < 2; row++) {
        const start = axis === 'x' ? point(i, 0) : point(0, i);
        const end = axis === 'x' ? point(i + 1, 0) : point(0, i + 1);
        const z = row * 11;
        w.poly([start.x, start.y - z, end.x, end.y - z, end.x, end.y - z - 10, start.x, start.y - z - 10])
          .fill(stoneColors[(i + row) % stoneColors.length]).stroke({ color: 0x25221d, width: 0.7 });
      }
    }
  }
  for (const z of [12, 76, h - 7]) {
    const p = point(0, 0, z), east = point(map.columns, 0, z), west = point(0, map.rows, z);
    w.moveTo(west.x, west.y).lineTo(p.x, p.y).lineTo(east.x, east.y).stroke({ color: z > 100 ? 0x795635 : 0x4d3421, width: z > 100 ? 12 : 5 });
    w.moveTo(west.x, west.y - 3).lineTo(p.x, p.y - 3).lineTo(east.x, east.y - 3).stroke({ color: 0xa17c49, alpha: 0.2, width: 1 });
  }
  for (let x = 0; x <= map.columns; x += 3.5) beam(w, x, 0, h + 5);
  for (let y = 3; y <= map.rows; y += 3) beam(w, 0, y, h + 5);
  for (const x of [0.2, 3.7, 7.2, 10.7]) {
    const top = point(x, 0, h - 20), end = point(x + 1.1, 0, 71);
    w.moveTo(top.x, top.y).lineTo(end.x, end.y).stroke({ color: 0x5f4128, width: 7 });
    w.moveTo(top.x, top.y - 2).lineTo(end.x, end.y - 2).stroke({ color: 0x9a7342, alpha: 0.35, width: 1 });
  }
  for (const y of [0.2, 3.2, 6.2, 9.2]) {
    const top = point(0, y, h - 20), end = point(0, y + 1.1, 71);
    w.moveTo(top.x, top.y).lineTo(end.x, end.y).stroke({ color: 0x533b26, width: 7 });
  }

  // Original wall hangings, independent from the configurable tavern identity.
  for (const x of [1.8, 8.9]) {
    const p = point(x, 0, h - 10);
    w.poly([p.x - 18, p.y, p.x + 18, p.y + 18, p.x + 18, p.y + 103, p.x, p.y + 110, p.x - 18, p.y + 85])
      .fill(0x202e44).stroke({ color: 0x9b7946, width: 1.3 });
    w.moveTo(p.x, p.y + 31).lineTo(p.x, p.y + 77).moveTo(p.x - 11, p.y + 48).lineTo(p.x + 11, p.y + 59)
      .stroke({ color: 0xb99454, width: 2 });
    w.circle(p.x, p.y + 54, 8).stroke({ color: 0xb99454, width: 1.5 });
  }
}
