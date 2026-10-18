import { ImageSource, Rectangle, Texture } from 'pixi.js';
import type { PropKind } from '../world/tavernMap';
import { atlasFrames } from './atlasFrames';

export async function loadTavernAtlas() {
  const image = new Image();
  image.decoding = 'async';
  image.src = '/social-hub/tavern-props-v1.png';
  await image.decode();
  if (image.naturalWidth !== 1254 || image.naturalHeight !== 1254) {
    throw new Error('Unexpected tavern atlas dimensions');
  }
  // Alpha-aware picking avoids blocking floor clicks in transparent sprite margins.
  const picking = document.createElement('canvas');
  picking.width = image.naturalWidth; picking.height = image.naturalHeight;
  const ctx = picking.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Atlas picking unavailable');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, picking.width, picking.height).data;
  picking.width = picking.height = 0;
  // Scene-owned source: no shared Assets cache is destroyed during StrictMode/remounts.
  const source = new ImageSource({ resource: image, scaleMode: 'linear' });
  const textures = Object.fromEntries(Object.entries(atlasFrames).map(([key, entry]) => [
    key, new Texture({ source, frame: new Rectangle(...entry.frame) }),
  ])) as Record<PropKind, Texture>;
  return {
    textures,
    isOpaque(kind: PropKind, x: number, y: number) {
      const [left, top, width, height] = atlasFrames[kind].frame;
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return pixels[((top + Math.floor(y)) * 1254 + left + Math.floor(x)) * 4 + 3] > 70;
    },
    destroy() {
      Object.values(textures).forEach(texture => texture.destroy(false));
      source.destroy();
      image.src = '';
    },
  };
}

export type TavernAtlas = Awaited<ReturnType<typeof loadTavernAtlas>>;
