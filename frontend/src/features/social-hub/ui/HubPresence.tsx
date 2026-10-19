import type { RoomState } from '../multiplayer/protocol';

export function HubPresence({ state, connected, retry }: { state: RoomState; connected: boolean; retry: () => void }) {
  return <section className="social-hub-presence" aria-labelledby="hub-presence-title">
    <header><h2 id="hub-presence-title">Jogadores na taverna ({state.players.length})</h2>
      {state.status !== 'joining' && <button type="button" className="ui-button ui-button-secondary" disabled={!connected} onClick={retry}>Reconectar à sala</button>}</header>
    <p role="status">{state.status === 'joined' ? 'Conectado ao salão compartilhado.' : state.status === 'joining' ? 'Validando personagem e entrando na sala…'
      : state.status === 'offline' ? 'Sem conexão com a sala. A movimentação está pausada; a entrada será retomada quando a conexão voltar.' : state.error}</p>
    {state.status === 'joined' && state.error && <p role="status">{state.error}</p>}
    {!!state.players.length && <ul aria-label="Personagens presentes">{state.players.map(player => <li key={player.id}>
      <strong>{player.name}{player.id === state.selfId ? ' (você)' : ''}</strong>
      <span>{player.level === null ? 'Nível não informado' : `Nível ${player.level}`} · {player.presence === 'away' ? 'Ausente' : 'Online'}</span>
    </li>)}</ul>}
  </section>;
}
