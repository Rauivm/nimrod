import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, UserRound } from 'lucide-react';
import { useHubCharacters } from '../characters/useHubCharacters';
import { characterImageUrl } from '../characters/hubCharacters';
import type { HubAccount, HubCharacter, LoadCharacters, ObserveCharacters } from '../characters/hubCharacters';
import type { ReactNode } from 'react';
import { hubConfig } from '../config/hubConfig';
import { HubViewport } from './HubViewport';
import { HubAppearance } from './HubAppearance';

function CharacterPortrait({ character }: { character: HubCharacter }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = [characterImageUrl(character.tokenImg), characterImageUrl(character.portraitImg)].find(url => url && !failed.includes(url));
  return <div className="social-hub-character-portrait">{src
    ? <img src={src} alt={`Retrato de ${character.name}`} onError={() => setFailed(previous => [...previous, src])} />
    : <UserRound size={32} aria-label="Retrato indisponível" role="img" />}</div>;
}

export function HubCharacters({ account, load, observe, connected, foundryAction }: {
  account: HubAccount; load: LoadCharacters; observe: ObserveCharacters; connected: boolean; foundryAction: ReactNode;
}) {
  const roster = useHubCharacters(account.id, load, observe, connected);
  return <>
    <section className="social-hub-characters" aria-labelledby="hub-characters-title" aria-busy={roster.status === 'loading'}>
      <header><div><h2 id="hub-characters-title">Seu personagem na taverna</h2><p>Conta: {account.displayName || 'Conta Nimrod'}</p></div>
        <button type="button" className="ui-button ui-button-secondary" disabled={roster.status === 'loading'} onClick={roster.refresh} aria-label="Atualizar personagens da taverna"><RefreshCw size={16} aria-hidden="true" />Atualizar</button></header>
      {roster.status === 'loading' ? <p role="status">Consultando seus personagens autorizados… A exploração fica pausada durante a atualização.</p>
        : roster.status === 'error' ? <div><p role="alert">Não foi possível carregar seus personagens. {roster.error}</p><button type="button" className="ui-button ui-button-secondary" onClick={roster.refresh}>Tentar carregar personagens novamente</button></div>
        : !roster.characters.length ? <p role="status">Nenhum personagem ativo, vivo e não aposentado está vinculado à sua conta. <Link to={hubConfig.routes.profile}>Vincular personagem no Perfil</Link></p>
        : <div className="social-hub-character-content"><div>
          <label htmlFor="hub-character-choice">Personagem para explorar</label>
          <select id="hub-character-choice" value={roster.selectedId ?? ''} onChange={event => roster.select(event.target.value)}>
            <option value="">Selecione um personagem</option>
            {roster.characters.map(character => <option key={character.id} value={character.id}>{character.name} · {character.level === null ? 'Nível não informado' : `Nível ${character.level}`}</option>)}
          </select>
          </div>
          {roster.selected ? <section className="social-hub-character-card" aria-label="Personagem selecionado">
            <CharacterPortrait key={roster.selected.id} character={roster.selected} />
            <div><h3>{roster.selected.name}</h3><p>{roster.selected.level === null ? 'Nível não informado' : `Nível ${roster.selected.level}`} · {roster.selected.classe || 'Classe não informada'} · {roster.selected.race || 'Raça não informada'}</p>
              <p>{roster.selected.foundryActorId ? 'Actor Foundry vinculado' : 'Personagem do Nimrod sem Actor Foundry vinculado'}{roster.selected.lastSyncedAt && <> · Sincronizado em <time dateTime={roster.selected.lastSyncedAt}>{new Date(roster.selected.lastSyncedAt).toLocaleString('pt-BR')}</time></>}</p>
              <HubAppearance classe={roster.selected.classe} /></div>
          </section> : <p role="status">Escolha um personagem vinculado para entrar na taverna.</p>}
        </div>}
    </section>
    {roster.selected && <HubViewport key={roster.selected.id} character={roster.selected} foundryAction={foundryAction} />}
  </>;
}
