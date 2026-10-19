import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Scroll } from 'lucide-react';
import { hubConfig } from './config/hubConfig';
import { HubCharacters } from './ui/HubCharacters';
import './social-hub.css';
import type { ReactNode } from 'react';
import type { HubAccount, LoadCharacters, ObserveCharacters } from './characters/hubCharacters';
import type { HubTransport } from './multiplayer/protocol';

interface SocialHubProps {
  account: HubAccount | null;
  loadCharacters: LoadCharacters;
  observeCharacters: ObserveCharacters;
  connected: boolean;
  transport: HubTransport;
  chooseClassic: () => void;
  chooseGame: () => void;
  foundryAction: ReactNode;
}

export function SocialHub({ account, loadCharacters, observeCharacters, connected, transport, chooseClassic, chooseGame, foundryAction }: SocialHubProps) {
  return (
    <section className="social-hub" aria-labelledby="social-hub-title">
      <header className="social-hub-heading">
        <span className="social-hub-badge">{hubConfig.identity.stage}</span>
        <h1 id="social-hub-title">{hubConfig.identity.name}</h1>
        <p>{hubConfig.identity.description}</p>
      </header>
      <nav className="social-hub-navigation" aria-label="Alternar experiência">
        <Link className="ui-button ui-button-secondary" to={hubConfig.routes.classic} onClick={chooseClassic}><ArrowLeft size={16} aria-hidden="true" />Modo Clássico</Link>
        <Link className="ui-button ui-button-secondary" to={hubConfig.routes.mana} onClick={chooseGame}><ExternalLink size={16} aria-hidden="true" />Source of Mana</Link>
        <Link className="ui-button ui-button-ghost" to={hubConfig.routes.missions}><Scroll size={16} aria-hidden="true" />Quadro de missões</Link>
      </nav>
      {account ? <HubCharacters account={account} load={loadCharacters} observe={observeCharacters} connected={connected} transport={transport} foundryAction={foundryAction} /> : <div className="social-hub-auth" role="status">Entre na sua conta Nimrod para acessar a prévia. A mesma sessão vale para todas as experiências.</div>}
      <p className="social-hub-scope">Salão compartilhado com presença e movimentação validadas pelo servidor. Os presets visuais não alteram o inventário real. Chat e interações sociais serão desenvolvidos na Sprint 8. O Source of Mana continua acessível.</p>
    </section>
  );
}
