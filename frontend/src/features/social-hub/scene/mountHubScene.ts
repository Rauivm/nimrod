import type { InteractionId } from '../world/tavernMap';

export interface HubSceneHandle {
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  setZoom?(zoom: number): void;
  approach?(id: InteractionId): void;
  stopExploring?(): void;
  destroy(): void;
}

export type SceneStatus = 'loading' | 'ready' | 'error';
type ObserveSize = (host: HTMLElement, resize: () => void) => () => void;

const observeSize: ObserveSize = (host, resize) => {
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  return () => observer.disconnect();
};

/** Owns one async scene lifetime, including late init after React StrictMode cleanup. */
export function mountHubScene(
  host: HTMLElement,
  createScene: () => Promise<HubSceneHandle>,
  onStatus: (status: SceneStatus) => void,
  observe: ObserveSize = observeSize,
): () => void {
  let disposed = false;
  let scene: HubSceneHandle | null = null;
  let stopObserving: (() => void) | undefined;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopObserving?.();
    if (!scene) return;
    scene.canvas.removeEventListener('webglcontextlost', fail);
    scene.canvas.remove();
    scene.destroy();
    scene = null;
  };

  function fail() {
    if (disposed) return;
    dispose();
    onStatus('error');
  }

  onStatus('loading');
  void Promise.resolve().then(createScene).then(created => {
    if (disposed) {
      created.destroy();
      return;
    }
    scene = created;
    const resize = () => {
      if (disposed || !scene) return;
      const { width, height } = host.getBoundingClientRect();
      try { scene.resize(Math.max(1, width), Math.max(1, height)); }
      catch { fail(); }
    };
    scene.canvas.addEventListener('webglcontextlost', fail);
    host.appendChild(scene.canvas);
    stopObserving = observe(host, resize);
    resize();
    if (!disposed) onStatus('ready');
  }).catch(fail);

  return dispose;
}
