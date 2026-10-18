import type { Container, Application } from 'pixi.js';
import { fitCamera } from '../world/isometric';
import type { Bounds } from '../world/isometric';

// Input arbitration lives in TavernExplorer: a drag pans, a tap walks/interacts.
export class TavernCamera {
  private zoom = 1;
  private offset = { x: 0, y: 0 };
  constructor(private readonly app: Application, private readonly world: Container, private readonly bounds: Bounds) {}

  get canPan() { return this.zoom > 1; }

  pan(dx: number, dy: number) {
    this.offset.x += dx; this.offset.y += dy;
    this.apply(); this.app.render();
  }

  setZoom(zoom: number) {
    this.zoom = Math.max(1, Math.min(2.5, zoom));
    this.offset = { x: 0, y: 0 };
    this.app.canvas.style.touchAction = this.zoom > 1 ? 'none' : 'pan-y';
    this.app.canvas.style.cursor = this.zoom > 1 ? 'grab' : 'crosshair';
    this.apply();
  }

  apply() {
    const { width, height } = this.app.screen;
    const camera = fitCamera(this.bounds, { x: width, y: height }, this.zoom, width < 480 ? 8 : 20);
    const rangeX = Math.max(0, (this.bounds.width * camera.scale - width) / 2 + 24);
    const rangeY = Math.max(0, (this.bounds.height * camera.scale - height) / 2 + 24);
    this.offset.x = Math.max(-rangeX, Math.min(rangeX, this.offset.x));
    this.offset.y = Math.max(-rangeY, Math.min(rangeY, this.offset.y));
    this.world.scale.set(camera.scale);
    this.world.position.set(camera.x + this.offset.x, camera.y + this.offset.y);
  }

}
