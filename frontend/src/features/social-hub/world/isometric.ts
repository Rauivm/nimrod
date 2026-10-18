export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface IsoGrid { tileWidth: number; tileHeight: number }

export function project(point: Point, grid: IsoGrid): Point {
  return { x: (point.x - point.y) * grid.tileWidth / 2, y: (point.x + point.y) * grid.tileHeight / 2 };
}

export function unproject(point: Point, grid: IsoGrid): Point {
  return { x: point.x / grid.tileWidth + point.y / grid.tileHeight, y: point.y / grid.tileHeight - point.x / grid.tileWidth };
}

export function depthAt(point: Point): number {
  return point.x + point.y;
}

/** Fit the complete cutaway, including tall furniture/walls, without stretching the projection. */
export function fitCamera(bounds: Bounds, viewport: Point, zoom = 1, padding = 24) {
  const availableWidth = Math.max(1, viewport.x - padding * 2);
  const availableHeight = Math.max(1, viewport.y - padding * 2);
  const scale = Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)) * zoom;
  return {
    scale,
    x: viewport.x / 2 - (bounds.x + bounds.width / 2) * scale,
    y: viewport.y / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}
