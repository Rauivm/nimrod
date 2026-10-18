import { Container, Sprite } from 'pixi.js';
import { avatarPose, facingFromDirection } from './avatarAnimation';
import type { AvatarPose } from './avatarAnimation';
import type { AvatarAtlas, AvatarTextureLayer } from '../assets/avatarAtlas';
import type { Point } from '../world/isometric';

/** Layer compositor: current class artwork is baked; future pieces use the same pivots/slots. */
export class AvatarSprite {
  readonly root = new Container({ label: 'class-avatar' });
  pose: AvatarPose = avatarPose('se', false, 0, true);
  private readonly parts: { sprite: Sprite; layer: AvatarTextureLayer }[];
  private walkSeconds = 0;

  constructor(atlas: AvatarAtlas) {
    this.root.sortableChildren = true;
    this.parts = atlas.layers.map(layer => {
      const sprite = new Sprite({ texture: layer.front[1].texture, label: `avatar-${layer.slot}` });
      this.root.addChild(sprite); return { sprite, layer };
    });
  }

  update(direction: Point, moving: boolean, seconds: number, time: number, reduced: boolean) {
    this.walkSeconds = moving ? this.walkSeconds + Math.min(0.05, Math.max(0, seconds)) : 0;
    this.pose = avatarPose(facingFromDirection(direction, this.pose.facing), moving, this.walkSeconds, reduced);
    for (const { sprite, layer } of this.parts) {
      const frame = layer[this.pose.view][this.pose.frame];
      sprite.texture = frame.texture;
      sprite.anchor.set(...frame.anchor);
      sprite.scale.set(layer.scale * (this.pose.mirrored ? -1 : 1), layer.scale);
      sprite.zIndex = this.pose.view === 'front' ? layer.frontOrder : layer.backOrder;
    }
    // Gentle breathing on the real idle pose, disabled by reduced-motion preferences.
    this.root.y = moving || reduced ? 0 : Math.sin(time * 2) * 0.55;
  }
}
