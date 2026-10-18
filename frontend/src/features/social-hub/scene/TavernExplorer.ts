import type { Application } from 'pixi.js';
import { Navigation } from '../world/Navigation';
import { ExplorerMovement } from '../world/ExplorerMovement';
import { unproject } from '../world/isometric';
import { tavernMap as map } from '../world/tavernMap';
import type { InteractionId } from '../world/tavernMap';
import type { Point } from '../world/isometric';
import type { TavernEnvironment } from './TavernEnvironment';
import type { TavernCamera } from './TavernCamera';
import type { HubSceneEvents } from './HubSceneEvents';
import { ExplorerMarker } from './ExplorerMarker';
import type { HubCharacter } from '../characters/hubCharacters';
import type { AvatarAtlas } from '../assets/avatarAtlas';
import type { AvatarAppearance } from '../appearance/resolveAppearance';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

export class TavernExplorer {
  private readonly movement = new ExplorerMovement(new Navigation(map), map.spawn);
  private readonly marker: ExplorerMarker;
  private readonly keys = new Set<string>();
  private pending: InteractionId | null = null;
  private gesture: { id: number; start: Point; last: Point; dragged: boolean } | null = null;

  constructor(
    private readonly app: Application,
    private readonly environment: TavernEnvironment,
    private readonly camera: TavernCamera,
    private readonly events: HubSceneEvents,
    private readonly wake: () => void,
    character: HubCharacter,
    atlas: AvatarAtlas,
    appearance: AvatarAppearance,
  ) {
    this.marker = new ExplorerMarker(character, atlas);
    environment.world.addChild(this.marker.root);
    environment.labels.addChild(this.marker.nameplate);
    environment.floor.addChild(this.marker.destination);
    const canvas = app.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', `Exploração local com ${character.name}`);
    canvas.setAttribute('aria-describedby', 'tavern-controls');
    canvas.dataset.avatarPreset = appearance.preset.id;
    canvas.dataset.avatarEquipment = appearance.equipmentSource;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    canvas.addEventListener('lostpointercapture', this.pointerCancel);
    canvas.addEventListener('keydown', this.keyDown);
    canvas.addEventListener('keyup', this.keyUp);
    canvas.addEventListener('blur', this.suspend);
    window.addEventListener('blur', this.suspend);
    this.update(0, 0, true);
  }

  get active() { return this.movement.pending || this.keys.size > 0; }

  approach(id: InteractionId) {
    const point = map.points.find(item => item.id === id);
    if (!point) return;
    this.suspend();
    this.events.onInteraction(null);
    if (!this.movement.walkTo(point.position)) {
      this.events.onNotice('Não há caminho livre até este objeto.'); return;
    }
    this.pending = id;
    this.marker.target(point.position);
    this.events.onNotice(`Caminhando até ${point.label}.`);
    this.wake();
  }

  update(seconds: number, time: number, reduced: boolean) {
    this.movement.update(seconds);
    this.marker.update(this.movement, time, reduced, seconds);
    const canvas = this.app.canvas, p = this.movement.position;
    // Local diagnostics contain no account or character identifiers.
    canvas.dataset.explorerX = p.x.toFixed(4);
    canvas.dataset.explorerY = p.y.toFixed(4);
    canvas.dataset.walking = String(this.movement.moving);
    canvas.dataset.avatarFacing = this.marker.pose.facing;
    canvas.dataset.avatarFrame = String(this.marker.pose.frame);
    if (!this.movement.pending && !this.keys.size) {
      this.marker.target(null);
      if (this.pending) {
        const id = this.pending; this.pending = null;
        this.events.onNotice('Você chegou ao ponto de interação.');
        this.events.onInteraction(id);
      }
    }
  }

  suspend = () => {
    const wasActive = this.active;
    this.keys.clear(); this.movement.stop(); this.pending = null;
    this.marker.target(null);
    this.pointerCancel();
    this.update(0, 0, true);
    this.app.render();
    if (wasActive) this.events.onNotice('Exploração pausada. Escolha um destino para continuar.');
  };

  private localPoint(event: PointerEvent): Point {
    const rect = this.app.canvas.getBoundingClientRect();
    return this.environment.root.toLocal({
      x: (event.clientX - rect.left) * this.app.screen.width / rect.width,
      y: (event.clientY - rect.top) * this.app.screen.height / rect.height,
    });
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || this.gesture) return;
    this.app.canvas.focus({ preventScroll: true });
    this.gesture = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, last: { x: event.clientX, y: event.clientY }, dragged: false };
    this.app.canvas.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    const g = this.gesture;
    if (!g || g.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - g.start.x, event.clientY - g.start.y) > 6) g.dragged = true;
    if (g.dragged && this.camera.canPan) {
      this.camera.pan(event.clientX - g.last.x, event.clientY - g.last.y);
    }
    g.last = { x: event.clientX, y: event.clientY };
  };

  private pointerUp = (event: PointerEvent) => {
    const g = this.gesture;
    if (!g || g.id !== event.pointerId) return;
    this.pointerCancel();
    if (g.dragged) return;
    const local = this.localPoint(event), hit = this.environment.hitProp(local);
    const point = map.points.find(item => item.target === hit);
    if (point) { this.approach(point.id); return; }
    this.suspend(); this.events.onInteraction(null);
    if (hit) { this.events.onNotice('Há um móvel aqui. Escolha um ponto livre do piso.'); return; }
    const target = unproject(local, map);
    if (!this.movement.walkTo(target)) {
      this.events.onNotice('Destino bloqueado ou fora do salão. Escolha um ponto livre do piso.'); return;
    }
    this.marker.target(target);
    this.events.onNotice('Explorando o salão.');
    this.wake();
  };

  private pointerCancel = (event?: PointerEvent) => {
    if (event && this.gesture && event.pointerId !== this.gesture.id) return;
    const g = this.gesture; this.gesture = null;
    if (g && this.app.canvas.hasPointerCapture(g.id)) this.app.canvas.releasePointerCapture(g.id);
  };

  private keyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (movementKeys.has(event.code)) {
      event.preventDefault(); this.keys.add(event.code);
      this.pending = null; this.marker.target(null); this.events.onInteraction(null);
      this.updateInput(); this.wake();
    } else if (event.code === 'Escape') {
      event.preventDefault(); this.suspend(); this.events.onInteraction(null);
      this.events.onNotice('Exploração pausada.');
    } else if ((event.code === 'KeyE' || event.code === 'Enter') && !event.repeat) {
      event.preventDefault();
      const nearest = [...map.points].sort((a, b) => this.distance(a.position) - this.distance(b.position))[0];
      if (this.distance(nearest.position) <= 0.9) this.approach(nearest.id);
      else this.events.onNotice('Aproxime-se de uma área ou escolha um dos botões abaixo do mapa.');
    }
  };

  private keyUp = (event: KeyboardEvent) => {
    if (!movementKeys.has(event.code)) return;
    event.preventDefault(); this.keys.delete(event.code); this.updateInput();
  };

  private distance(point: Point) {
    return Math.hypot(this.movement.position.x - point.x, this.movement.position.y - point.y);
  }

  private updateInput() {
    const has = (...codes: string[]) => codes.some(code => this.keys.has(code)) ? 1 : 0;
    const x = has('KeyD', 'ArrowRight') - has('KeyA', 'ArrowLeft');
    const y = has('KeyS', 'ArrowDown') - has('KeyW', 'ArrowUp');
    this.movement.setInput({ x: x + y, y: y - x });
  }

  destroy() {
    this.pointerCancel();
    this.movement.stop(); this.keys.clear(); this.pending = null;
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerUp);
    canvas.removeEventListener('pointercancel', this.pointerCancel);
    canvas.removeEventListener('lostpointercapture', this.pointerCancel);
    canvas.removeEventListener('keydown', this.keyDown);
    canvas.removeEventListener('keyup', this.keyUp);
    canvas.removeEventListener('blur', this.suspend);
    window.removeEventListener('blur', this.suspend);
  }
}
