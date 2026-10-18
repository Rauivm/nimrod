import type { PropKind } from '../world/tavernMap';

interface AtlasFrame {
  frame: [number, number, number, number];
  anchor: [number, number];
  hull?: number[];
}

// Independently framed silhouettes, not a background image. Hulls exclude neighboring atlas cells.
export const atlasFrames: Record<PropKind, AtlasFrame> = {
  counter: { frame: [0, 0, 488, 406], anchor: [0.49, 0.74], hull: [0, 0, 488, 0, 488, 270, 110, 406, 0, 350] },
  table: { frame: [497, 15, 365, 370], anchor: [0.5, 0.78] },
  fireplace: { frame: [872, 0, 382, 414], anchor: [0.52, 0.85] },
  shelf: { frame: [0, 370, 429, 464], anchor: [0.52, 0.83], hull: [0, 46, 330, 0, 429, 40, 429, 375, 45, 464, 0, 423] },
  board: { frame: [434, 384, 397, 441], anchor: [0.54, 0.83] },
  stage: { frame: [831, 415, 423, 411], anchor: [0.5, 0.84] },
  chair: { frame: [74, 808, 301, 414], anchor: [0.48, 0.83], hull: [0, 180, 140, 0, 270, 50, 301, 295, 185, 414, 15, 330] },
  barrels: { frame: [428, 838, 431, 384], anchor: [0.52, 0.75] },
  arch: { frame: [883, 814, 371, 440], anchor: [0.49, 0.83] },
};
