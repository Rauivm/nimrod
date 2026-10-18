import { useEffect, useRef, useState } from 'react';
import { mountHubScene } from './mountHubScene';
import type { HubSceneHandle, SceneStatus } from './mountHubScene';
import type { InteractionId } from '../world/tavernMap';
import type { HubCharacter } from '../characters/hubCharacters';

export function useHubScene(character: HubCharacter) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SceneStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [interaction, setInteraction] = useState<InteractionId | null>(null);
  const [notice, setNotice] = useState('Personagem selecionado para exploração local. Escolha um ponto do piso ou uma área.');
  const zoomRef = useRef(zoom);
  const sceneRef = useRef<HubSceneHandle | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
    sceneRef.current?.setZoom?.(zoom);
  }, [zoom]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let active = true;
    const dispose = mountHubScene(host, async () => {
      const { HubScene } = await import('./HubScene');
      const scene = await HubScene.create({
        onInteraction: id => { if (active) setInteraction(id); },
        onNotice: message => { if (active) setNotice(message); },
      }, character);
      if (active) {
        sceneRef.current = scene;
        scene.setZoom(zoomRef.current);
      }
      return scene;
    }, next => {
      if (!active) return;
      setStatus(next);
      if (next !== 'ready') setInteraction(null);
      if (next === 'error') sceneRef.current = null;
    });
    return () => {
      active = false;
      sceneRef.current = null;
      dispose();
    };
  }, [attempt, character]);

  return {
    mountRef, status, zoom, interaction, notice,
    approach: (id: InteractionId) => {
      sceneRef.current?.canvas.focus({ preventScroll: true });
      sceneRef.current?.approach?.(id);
    },
    closeInteraction: () => {
      setInteraction(null);
      sceneRef.current?.stopExploring?.();
      sceneRef.current?.canvas.focus({ preventScroll: true });
    },
    zoomIn: () => setZoom(value => Math.min(2.5, value + 0.25)),
    zoomOut: () => setZoom(value => Math.max(1, value - 0.25)),
    resetView: () => { setZoom(1); sceneRef.current?.setZoom?.(1); },
    retry: () => setAttempt(value => value + 1),
  };
}
