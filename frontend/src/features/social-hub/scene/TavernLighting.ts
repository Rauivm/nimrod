import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { depthAt, project } from '../world/isometric';
import { tavernMap as map } from '../world/tavernMap';

function flameShape() {
  const flame = new Container();
  const outer = new Graphics().moveTo(-19, 0).bezierCurveTo(-32, -18, -8, -29, -12, -48)
    .bezierCurveTo(3, -36, 3, -20, 12, -34).bezierCurveTo(31, -11, 26, 0, 14, 3)
    .closePath().fill(0xeb6a21);
  const inner = new Graphics().moveTo(-10, 1).bezierCurveTo(-17, -13, 0, -18, -1, -33)
    .bezierCurveTo(12, -17, 19, -8, 9, 2).closePath().fill(0xffc361);
  const core = new Graphics().ellipse(0, -5, 7, 11).fill(0xffe6a2);
  outer.alpha = 0.72;
  inner.alpha = 0.85;
  outer.blendMode = inner.blendMode = 'add';
  flame.addChild(outer, inner, core);
  return flame;
}

export class TavernLighting {
  private readonly glow: Texture;
  private readonly flickers: { sprite: Sprite; base: number; phase: number }[] = [];
  private readonly flames: { node: Container; size: number; phase: number }[] = [];

  constructor(ground: Container, world: Container) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Light texture unavailable');
    const gradient = ctx.createRadialGradient(96, 96, 0, 96, 96, 96);
    gradient.addColorStop(0, '#ffe8aa');
    gradient.addColorStop(0.18, '#f8ad49c0');
    gradient.addColorStop(0.5, '#c36d2248');
    gradient.addColorStop(1, '#9c471000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 192, 192);
    this.glow = new Texture({ source: new CanvasSource({ resource: canvas }) });

    const hearth = map.props.find(prop => prop.id === 'hearth')!;
    const p = project(hearth.position, map);
    this.addGlow(ground, p.x - 14, p.y + 5, 2.7, 0.48, 0);
    const fire = flameShape();
    const fireGlow = new Sprite(this.glow);
    fireGlow.anchor.set(0.5);
    fireGlow.position.set(0, -12);
    fireGlow.scale.set(0.65, 0.45);
    fireGlow.blendMode = 'add';
    fireGlow.alpha = 0.32;
    fire.addChildAt(fireGlow, 0);
    fire.position.set(p.x - 10, p.y - 26);
    fire.zIndex = depthAt(hearth.position) + 0.01;
    world.addChild(fire);
    this.flames.push({ node: fire, size: 0.65, phase: 0 });

    for (const [index, table] of map.tables.entries()) {
      const spot = project(table, map);
      this.addGlow(ground, spot.x, spot.y - 17, 1.25, 0.15, index + 1);
    }

    for (const [index, tile] of [{ x: 1.7, y: 0 }, { x: 6.5, y: 0 }, { x: 13.3, y: 0 }, { x: 0, y: 8 }].entries()) {
      const pos = project(tile, map);
      const torch = new Container({ label: `wall-torch-${index}` });
      torch.position.set(pos.x, pos.y - 80);
      torch.zIndex = -1;
      const bracket = new Graphics().roundRect(-5, 0, 10, 26, 2).fill(0x241c17).stroke({ color: 0x967044, width: 1 })
        .moveTo(-7, 8).lineTo(5, 18).lineTo(8, -3).stroke({ color: 0x191615, width: 3 });
      const fire = flameShape();
      torch.addChild(bracket, fire);
      world.addChild(torch);
      this.flames.push({ node: fire, size: 0.3, phase: index + 1 });
      this.addGlow(ground, pos.x, pos.y - 70, 1.8, 0.3, index + 3);
    }
    this.update(0);
  }

  private addGlow(layer: Container, x: number, y: number, size: number, base: number, phase: number) {
    const sprite = new Sprite(this.glow);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.scale.set(size, size * 0.62);
    sprite.blendMode = 'add';
    layer.addChild(sprite);
    this.flickers.push({ sprite, base, phase });
  }

  update(time: number) {
    for (const { sprite, base, phase } of this.flickers) sprite.alpha = base * (0.94 + Math.sin(time * 4.7 + phase) * 0.06);
    for (const { node, size, phase } of this.flames) {
      node.scale.set(size * (1 + Math.sin(time * 5.3 + phase) * 0.06), size * (1 + Math.sin(time * 7.1 + phase) * 0.11));
      node.skew.x = Math.sin(time * 3.3 + phase) * 0.07;
    }
  }

  destroy() {
    this.glow.destroy(true);
    this.flickers.length = 0;
    this.flames.length = 0;
  }
}
