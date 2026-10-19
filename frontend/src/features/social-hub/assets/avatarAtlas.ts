import { ImageSource, Rectangle, Texture } from 'pixi.js';
import type { AvatarAppearance, AvatarSlot } from '../appearance/resolveAppearance';
import type { AvatarSheetId } from '../appearance/classPresets';
import { avatarSheets } from './avatarFrames';
import type { AvatarFrame } from './avatarFrames';

export interface AvatarTextureFrame { texture: Texture; anchor: readonly [number, number] }
export interface AvatarTextureLayer {
  slot: AvatarSlot; frontOrder: number; backOrder: number; scale: number;
  front: AvatarTextureFrame[]; back: AvatarTextureFrame[];
}

/** Loads only sheets used by this recipe. All sources/textures belong to one scene. */
export async function loadAvatarAtlas(appearance: AvatarAppearance, signal?: AbortSignal) {
  const sources = new Map<AvatarSheetId, ImageSource>();
  const images: HTMLImageElement[] = [], textures: Texture[] = [];
  let disposed = false;
  const destroy = () => {
    if (disposed) return; disposed = true;
    textures.forEach(texture => texture.destroy(false));
    sources.forEach(source => source.destroy());
    images.forEach(image => { image.src = ''; });
  };
  const abort = () => destroy();
  if (signal?.aborted) throw new DOMException('Avatar load cancelled', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const layers: AvatarTextureLayer[] = [];
    for (const layer of appearance.layers) {
      const { sheet, row } = layer.preset, metadata = avatarSheets[sheet];
      if (!sources.has(sheet)) {
        const image = new Image(); images.push(image);
        image.decoding = 'async'; image.src = `/social-hub/${metadata.file}`;
        await image.decode();
        if (signal?.aborted) throw new DOMException('Avatar load cancelled', 'AbortError');
        if (image.naturalWidth !== metadata.width || image.naturalHeight !== metadata.height) throw new Error('Unexpected avatar sheet dimensions');
        sources.set(sheet, new ImageSource({ resource: image, scaleMode: 'linear' }));
      }
      const clip = metadata.presets[row];
      if (!clip || clip.front.length !== 3 || clip.back.length !== 3) throw new Error('Avatar clip unavailable');
      const frame = (entry: AvatarFrame): AvatarTextureFrame => {
        const texture = new Texture({ source: sources.get(sheet)!, frame: new Rectangle(...entry.rect) });
        textures.push(texture); return { texture, anchor: entry.anchor };
      };
      layers.push({ slot: layer.slot, frontOrder: layer.frontOrder, backOrder: layer.backOrder,
        scale: 94 / clip.nativeHeight, front: clip.front.map(frame), back: clip.back.map(frame) });
    }
    return { layers, destroy };
  } catch (error) { destroy(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

export type AvatarAtlas = Awaited<ReturnType<typeof loadAvatarAtlas>>;
