import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { atlasFrames } from '../assets/atlasFrames';
import type { TavernAtlas } from '../assets/tavernAtlas';
import type { Point } from '../world/isometric';
import type { TavernProp } from '../world/tavernMap';
import { depthAt, project } from '../world/isometric';
import { tavernMap as map } from '../world/tavernMap';
import { drawArchitecture } from './drawArchitecture';
import { TavernLighting } from './TavernLighting';

export class TavernEnvironment {
  readonly root = new Container({ label: 'tavern-map' });
  readonly world = new Container({ label: 'world' });
  readonly floor = new Container({ label: 'floor' });
  readonly labels = new Container({ label: 'labels' });
  private readonly holders: { prop: TavernProp; node: Container }[] = [];
  readonly bounds = {
    x: -map.rows * map.tileWidth / 2 - 40,
    y: -map.wallHeight - 32,
    width: (map.columns + map.rows) * map.tileWidth / 2 + 80,
    height: (map.columns + map.rows) * map.tileHeight / 2 + map.wallHeight + 90,
  };
  private readonly lighting: TavernLighting;

  constructor(private readonly atlas: TavernAtlas) {
    const floor = this.floor;
    const walls = new Container({ label: 'walls' });
    const shadows = new Container({ label: 'contact-shadows' });
    const world = this.world;
    world.sortableChildren = true;
    const effects = new Container({ label: 'lighting' });
    const labels = this.labels;
    this.root.addChild(floor, walls, shadows, effects, world, labels);
    drawArchitecture(floor, walls);

    for (const prop of map.props) {
      const entry = atlasFrames[prop.kind];
      const p = project(prop.position, map);
      const shadow = new Graphics().ellipse(p.x, p.y + 6, prop.width * 0.35, prop.width * 0.1).fill({ color: 0x130d09, alpha: 0.23 });
      shadows.addChild(shadow);
      const holder = new Container({ label: prop.id });
      holder.position.set(p.x, p.y);
      const scale = prop.width / entry.frame[2];
      // Shear the ground-facing axis while keeping vertical posts upright.
      // This matches the wall's isometric direction without tilting the entire bitmap.
      const skew = Math.atan(prop.shearY ?? 0);
      holder.skew.y = skew;
      holder.scale.set((prop.flip ? -scale : scale) / Math.cos(skew), scale);
      holder.zIndex = depthAt(prop.position);
      const sprite = new Sprite(atlas.textures[prop.kind]);
      sprite.anchor.set(...entry.anchor);
      holder.addChild(sprite);
      if (entry.hull) {
        const mask = new Graphics().poly(entry.hull.map((value, index) => value - entry.frame[index % 2 + 2] * entry.anchor[index % 2])).fill(0xffffff);
        holder.addChild(mask);
        sprite.mask = mask;
      }
      world.addChild(holder);
      this.holders.push({ prop, node: holder });
    }
    this.lighting = new TavernLighting(effects, world);

    // Physical area signs, not simulated NPCs or mission records.
    const signs = [
      { target: 'bar-counter', text: 'Balcão', lift: 195 },
      { target: 'quest-board', text: 'Mural de missões', lift: 184 },
      { target: 'musicians-stage', text: 'Músicos', lift: 180 },
      { target: 'tavern-entrance', text: 'Foundry VTT', lift: 153 },
    ];
    for (const sign of signs) {
      const prop = map.props.find(item => item.id === sign.target)!;
      const p = project(prop.position, map);
      const text = new Text({ text: sign.text, style: { fontFamily: 'Georgia, serif', fontSize: 13, fill: 0xe4c493, letterSpacing: 0.4 } });
      text.anchor.set(0.5);
      const backing = new Graphics().roundRect(-text.width / 2 - 10, -12, text.width + 20, 25, 4)
        .fill({ color: 0x19150f, alpha: 0.9 }).stroke({ color: 0x886d3b, alpha: 0.7, width: 1 });
      const label = new Container({ label: `sign-${sign.target}` });
      label.position.set(p.x, p.y - sign.lift);
      label.addChild(backing, text);
      labels.addChild(label);
    }
  }

  hitProp(point: Point): string | null {
    for (const { prop, node } of [...this.holders].sort((a, b) => b.node.zIndex - a.node.zIndex)) {
      const local = node.toLocal(point, this.root), entry = atlasFrames[prop.kind];
      const x = local.x + entry.frame[2] * entry.anchor[0], y = local.y + entry.frame[3] * entry.anchor[1];
      if (entry.hull) {
        let inside = false;
        for (let i = 0, j = entry.hull.length - 2; i < entry.hull.length; j = i, i += 2) {
          const ax = entry.hull[i], ay = entry.hull[i + 1], bx = entry.hull[j], by = entry.hull[j + 1];
          if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        }
        if (!inside) continue;
      }
      if (this.atlas.isOpaque(prop.kind, x, y)) return prop.id;
    }
    return null;
  }

  update(time: number) {
    this.lighting.update(time);
  }

  destroy() {
    this.lighting.destroy();
  }
}
