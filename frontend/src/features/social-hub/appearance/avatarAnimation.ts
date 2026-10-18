import type { Point } from '../world/isometric';

export type AvatarFacing = 'se' | 'sw' | 'ne' | 'nw';
export type AvatarView = 'front' | 'back';
export interface AvatarPose { facing: AvatarFacing; view: AvatarView; mirrored: boolean; frame: 0 | 1 | 2 }

export function facingFromDirection(direction: Point, previous: AvatarFacing = 'se'): AvatarFacing {
  const x = direction.x - direction.y, y = direction.x + direction.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-8) return previous;
  const east = Math.abs(x) < 1e-8 ? previous.endsWith('e') : x > 0;
  return y >= 0 ? east ? 'se' : 'sw' : east ? 'ne' : 'nw';
}

/** The middle frame is an actual idle pose. Reduced motion freezes limb animation. */
export function avatarPose(facing: AvatarFacing, moving: boolean, walkSeconds: number, reduced: boolean): AvatarPose {
  const cycle = [0, 1, 2, 1] as const;
  const time = Number.isFinite(walkSeconds) ? Math.max(0, walkSeconds) : 0;
  return {
    facing, view: facing.startsWith('s') ? 'front' : 'back', mirrored: facing.endsWith('w'),
    frame: moving && !reduced ? cycle[Math.floor(time * 8) % cycle.length] : 1,
  };
}
