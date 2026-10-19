import { Compass, Maximize, Minus, Plus, RefreshCw } from 'lucide-react';
import { useHubScene } from '../scene/useHubScene';
import { tavernMap } from '../world/tavernMap';
import type { ReactNode } from 'react';
import { HubInteraction } from './HubInteraction';
import type { HubCharacter } from '../characters/hubCharacters';
import type { HubTransport, RoomAdmission } from '../multiplayer/protocol';
import { useHubRoom } from '../multiplayer/useHubRoom';
import { HubPresence } from './HubPresence';
import { useEffect } from 'react';

export function HubViewport({ foundryAction, character, transport, connected, admission }: { foundryAction: ReactNode; character: HubCharacter; transport: HubTransport; connected: boolean; admission: RoomAdmission }) {
  const { room, state } = useHubRoom(character.id, transport, connected, admission);
  const { mountRef, status, retry, zoom, zoomIn, zoomOut, resetView, interaction, notice, approach, closeInteraction } = useHubScene(character, room);
  useEffect(() => {
    if (status === 'error') room.stop();
    else { room.start(); room.setConnected(connected); }
  }, [room, status, connected]);
  return (
    <>
    <HubPresence state={state} connected={connected} retry={room.retry} />
    <section className="social-hub-viewport" aria-label="Mapa isométrico da taverna" aria-describedby="tavern-map-description" aria-busy={status === 'loading'}>
      <div ref={mountRef} className="social-hub-canvas" />
      {status === 'ready' ? <>
        <span className="sr-only" role="status">Prévia HTML5 disponível</span>
        <div className="social-hub-map-heading"><span>{state.status === 'joined' ? 'Salão compartilhado' : 'Aguardando entrada na sala'}</span><small>{character.name} · {character.level === null ? 'Nível não informado' : `Nível ${character.level}`}</small></div>
        <div className="social-hub-camera" role="group" aria-label="Câmera do mapa">
          <button type="button" aria-label="Afastar câmera" disabled={zoom === 1} onClick={zoomOut}><Minus size={17} /></button>
          <output aria-live="polite" aria-label="Ampliação da câmera">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Aproximar câmera" disabled={zoom === 2.5} onClick={zoomIn}><Plus size={17} /></button>
          <button type="button" aria-label="Restaurar visão geral" onClick={resetView}><Maximize size={17} /></button>
        </div>
      </> : <div className="social-hub-scene-message">
        <Compass size={36} aria-hidden="true" />
        {status === 'error' ? <>
          <h2>Não foi possível abrir a prévia</h2>
          <p role="alert">A renderização está indisponível neste navegador. Tente novamente ou use as outras experiências pelos links acima.</p>
          <button type="button" className="ui-button ui-button-secondary" onClick={retry}><RefreshCw size={16} aria-hidden="true" />Tentar novamente</button>
        </> : <>
          <h2>Preparando o salão</h2>
          <span className="social-hub-render-status" role="status">Carregando o mapa…</span>
        </>}
      </div>}
    </section>
    <p id="tavern-map-description" className="sr-only">Salão medieval isométrico com móveis sólidos, balcão à esquerda, cinco mesas com cadeiras, lareira e palco ao fundo, mural junto à parede e portal do Foundry entre o balcão e o palco. Seu personagem é representado por um sprite de preset visual, com nome e nível reais; equipamentos do preset são apenas ilustrativos.</p>
    <p id="tavern-controls" className="social-hub-controls">Clique ou toque no piso para caminhar; nos objetos para se aproximar. Com o mapa em foco: WASD ou setas, E ou Enter para interagir, Esc para parar. Amplie e arraste para mover a câmera.</p>
    <ul className="social-hub-areas" aria-label="Áreas do mapa">{tavernMap.points.map(point => <li key={point.id}><button type="button" disabled={status !== 'ready' || state.status !== 'joined'} onClick={() => approach(point.id)}>Ir até {point.label}</button></li>)}</ul>
    <p className="social-hub-notice" role="status" aria-live="polite">{status === 'ready' ? notice : ''}</p>
    {status === 'ready' && interaction && <HubInteraction id={interaction} onClose={closeInteraction} foundryAction={foundryAction} />}
    </>
  );
}
