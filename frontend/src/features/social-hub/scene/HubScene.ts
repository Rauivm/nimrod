import { Application } from 'pixi.js';
import type { Ticker } from 'pixi.js';
import { hubConfig } from '../config/hubConfig';
import type { HubSceneHandle } from './mountHubScene';
import { loadTavernAtlas } from '../assets/tavernAtlas';
import type { TavernAtlas } from '../assets/tavernAtlas';
import { TavernEnvironment } from './TavernEnvironment';
import { TavernCamera } from './TavernCamera';
import { TavernExplorer } from './TavernExplorer';
import type { HubSceneEvents } from './HubSceneEvents';
import type { InteractionId } from '../world/tavernMap';
import type { HubCharacter } from '../characters/hubCharacters';
import { loadAvatarAtlas } from '../assets/avatarAtlas';
import type { AvatarAtlas } from '../assets/avatarAtlas';
import { resolveAppearance } from '../appearance/resolveAppearance';
import type { AvatarAppearance } from '../appearance/resolveAppearance';
import type { HubRoom } from '../multiplayer/HubRoom';
import { RoomAvatars } from './RoomAvatars';

/** Scene ownership boundary; all avatar destinations come from the room server. */
export class HubScene implements HubSceneHandle {
  private destroyed = false;
  private time = 0;
  private hidden = document.hidden;
  private readonly camera: TavernCamera;
  private readonly explorer: TavernExplorer;
  private readonly remotes: RoomAvatars;
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  private constructor(private readonly app: Application, private readonly atlas: TavernAtlas, private readonly avatarAtlas: AvatarAtlas, private readonly environment: TavernEnvironment, events: HubSceneEvents, character: HubCharacter, appearance: AvatarAppearance, room: HubRoom) {
    this.camera = new TavernCamera(app, environment.root, environment.bounds);
    this.explorer = new TavernExplorer(app, environment, this.camera, events, this.updateMotion, character, avatarAtlas, appearance, room);
    this.remotes = new RoomAvatars(environment, room, avatarAtlas, appearance.preset.id, this.updateMotion, events.onNotice, app.canvas);
    app.ticker.maxFPS = 30;
    app.ticker.add(this.animate);
    this.motion.addEventListener('change', this.updateMotion);
    document.addEventListener('visibilitychange', this.updateMotion);
    try { this.updateMotion(); }
    catch (error) {
      this.motion.removeEventListener('change', this.updateMotion);
      document.removeEventListener('visibilitychange', this.updateMotion);
      app.ticker.remove(this.animate);
      this.explorer.destroy();
      this.remotes.destroy();
      throw error;
    }
  }

  private animate = (ticker: Ticker) => {
    // A media preference can update at a frame boundary before its change event.
    // Publish the sampled preference too, including the last frame before stopping.
    this.app.canvas.dataset.motion = this.motion.matches ? 'reduced' : 'full';
    this.time += Math.min(ticker.deltaMS, 100) / 1000;
    this.environment.update(this.motion.matches ? 0 : this.time);
    this.explorer.update(ticker.deltaMS / 1000, this.time, this.motion.matches);
    this.remotes.update(ticker.deltaMS / 1000, this.time, this.motion.matches);
    if (this.motion.matches && !this.explorer.active && !this.remotes.active) { this.app.render(); this.app.stop(); }
  };

  private updateMotion = () => {
    if (this.destroyed || !this.explorer || !this.remotes) return;
    this.app.canvas.dataset.motion = this.motion.matches ? 'reduced' : 'full';
    if (document.hidden && !this.hidden) this.explorer.suspend();
    this.hidden = document.hidden;
    if (document.hidden || (this.motion.matches && !this.explorer.active && !this.remotes.active)) {
      this.app.stop();
      this.environment.update(0);
      // A preference change can arrive between keyup and the final movement frame.
      // Commit idle/reduced-motion graphics before stopping the ticker.
      this.explorer.update(0, this.time, true);
      this.remotes.update(0, this.time, true);
      this.app.render();
    } else this.app.start();
  };

  static async create(events: HubSceneEvents, character: HubCharacter, room: HubRoom): Promise<HubScene> {
    let atlas: TavernAtlas | undefined;
    let avatarAtlas: AvatarAtlas | undefined;
    const app = new Application();
    let environment: TavernEnvironment | undefined;
    try {
      const appearance = resolveAppearance(character.classe);
      atlas = await loadTavernAtlas();
      avatarAtlas = await loadAvatarAtlas(appearance);
      await app.init({
        width: 1,
        height: 1,
        // An explicit list prevents an untested WebGPU/Canvas fallback in Pixi 8.19.
        preference: ['webgl'],
        background: hubConfig.renderer.background,
        resolution: Math.min(window.devicePixelRatio || 1, hubConfig.renderer.maxResolution),
        autoDensity: true,
        autoStart: false,
        sharedTicker: false,
      });
      environment = new TavernEnvironment(atlas);
      app.stage.addChild(environment.root);
      app.canvas.dataset.renderer = 'pixi-webgl';
      app.canvas.dataset.map = 'nimrod-tavern-v1';
      return new HubScene(app, atlas, avatarAtlas, environment, events, character, appearance, room);
    } catch (error) {
      // init can fail before Pixi has a renderer; Application.destroy assumes it exists.
      if (app.renderer) app.destroy(true, { children: true });
      else app.stage.destroy({ children: true });
      environment?.destroy();
      avatarAtlas?.destroy();
      atlas?.destroy();
      throw error;
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.app.renderer.resize(width, height);
    this.camera.apply();
    this.app.render();
  }

  setZoom(zoom: number) {
    if (this.destroyed) return;
    this.camera.setZoom(zoom);
    this.app.render();
  }

  approach(id: InteractionId) { if (!this.destroyed) this.explorer.approach(id); }
  stopExploring() { if (!this.destroyed) this.explorer.suspend(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.motion.removeEventListener('change', this.updateMotion);
    document.removeEventListener('visibilitychange', this.updateMotion);
    this.app.ticker.remove(this.animate);
    this.explorer.destroy();
    this.remotes.destroy();
    this.app.destroy(true, { children: true });
    this.environment.destroy();
    this.avatarAtlas.destroy();
    this.atlas.destroy();
  }
}
