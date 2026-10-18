import { Container, Graphics, Text } from 'pixi.js';
import { depthAt, project } from '../world/isometric';
import type { ExplorerMovement } from '../world/ExplorerMovement';
import { tavernMap as map } from '../world/tavernMap';
import type { HubCharacter } from '../characters/hubCharacters';
import { AvatarSprite } from '../appearance/AvatarSprite';
import type { AvatarAtlas } from '../assets/avatarAtlas';

/** Class sprite on the ground-sorted layer, with a separately readable real nameplate. */
export class ExplorerMarker {
  readonly root = new Container({ label: 'local-explorer-marker' });
  readonly destination = new Graphics({ label: 'explorer-destination' });
  readonly nameplate = new Container({ label: 'selected-character-nameplate' });
  private readonly avatar: AvatarSprite;

  constructor(character: HubCharacter, atlas: AvatarAtlas) {
    this.avatar = new AvatarSprite(atlas);
    const base = new Graphics().ellipse(0, 0, 16, 8).fill({ color: 0x10302a, alpha: 0.42 })
      .stroke({ color: 0x8ce0d2, alpha: 0.55, width: 1 });
    this.root.addChild(base, this.avatar.root);
    const name = character.name.length > 32 ? `${character.name.slice(0, 31)}…` : character.name;
    const label = new Text({ text: `${name}\n${character.level === null ? 'Nível não informado' : `Nível ${character.level}`}`,
      style: { fontFamily: 'Georgia, serif', fontSize: 12, fill: 0xf8e7c6, align: 'center', wordWrap: true, wordWrapWidth: 185 } });
    label.anchor.set(0.5, 1); label.y = -102;
    const backing = new Graphics().roundRect(-label.width / 2 - 7, -label.height - 107, label.width + 14, label.height + 10, 4)
      .fill({ color: 0x132322, alpha: 0.95 }).stroke({ color: 0x80bfb0, alpha: 0.7, width: 1 });
    this.nameplate.addChild(backing, label);
  }

  target(position: { x: number; y: number } | null) {
    this.destination.clear();
    if (!position) return;
    const p = project(position, map);
    this.destination.ellipse(p.x, p.y, 15, 7).stroke({ color: 0x8ce0d2, width: 2, alpha: 0.9 });
  }

  get pose() { return this.avatar.pose; }

  update(movement: ExplorerMovement, time: number, reduced: boolean, seconds = 0) {
    const p = project(movement.position, map);
    this.root.position.set(p.x, p.y);
    this.nameplate.position.set(p.x, p.y);
    this.root.zIndex = depthAt(movement.position);
    this.avatar.update(movement.direction, movement.moving, seconds, time, reduced);
  }
}
