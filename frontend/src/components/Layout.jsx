import { Outlet, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWs } from '../contexts/WsContext.jsx';
import { api } from '../lib/api.js';
import { Sword, Skull, Map, Scroll, Wifi, WifiOff, ExternalLink } from 'lucide-react';

function FoundryButton({ user }) {
  const [foundryUrl, setFoundryUrl] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.get('/config').then(d => setFoundryUrl(d.foundryUrl)).catch(() => {});
  }, []);

  const handleEnter = () => {
    if (foundryUrl) window.open(foundryUrl, '_blank');
  };

  if (!foundryUrl) return null;

  const label = user?.role === 'GM' ? 'Iniciar Aventura' : 'Entrar na Aventura';

  return (
    <button onClick={handleEnter} className="foundry-btn" title={foundryUrl}>
      <Sword size={15} strokeWidth={2.5} />
      <span>{label}</span>
      <ExternalLink size={11} style={{ opacity: 0.6 }} />
    </button>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const { connected } = useWs();

  return (
    <div className="layout">
      <header className="site-header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-sigil">⚔</span>
            <span className="brand-name">NIMROD</span>
            <span className="brand-sub">Foundry VTT</span>
          </div>

          <nav className="main-nav">
            <NavLink to="/" end className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              <Scroll size={14} />
              <span>Taverna</span>
            </NavLink>
            <NavLink to="/missions" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              <Sword size={14} />
              <span>Missões</span>
            </NavLink>
            <NavLink to="/cemetery" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              <Skull size={14} />
              <span>Cemitério</span>
            </NavLink>
            <NavLink to="/maps" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              <Map size={14} />
              <span>Mapas</span>
            </NavLink>
          </nav>

          <div className="header-right">
            <div className={`ws-indicator ${connected ? 'connected' : 'disconnected'}`} title={connected ? 'Conectado' : 'Reconectando...'}>
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            </div>
            <FoundryButton user={user} />
            {user && (
              <div className="user-chip">
                <span className="user-chip-name">{user.name}</span>
                {user.role === 'GM' && <span className="gm-badge">GM</span>}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="site-main">
        <Outlet />
      </main>

      <style>{`
        .layout { min-height: 100vh; display: flex; flex-direction: column; }

        .site-header {
          position: sticky; top: 0; z-index: 100;
          background: rgba(10,9,5,0.95);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          box-shadow: 0 1px 20px rgba(0,0,0,0.5);
        }
        .header-inner {
          max-width: 1200px; margin: 0 auto;
          padding: 0 24px;
          height: 56px;
          display: flex; align-items: center; gap: 24px;
        }
        .header-brand {
          display: flex; align-items: center; gap: 8px;
          flex-shrink: 0;
        }
        .brand-sigil { color: var(--gold); font-size: 18px; }
        .brand-name {
          font-family: var(--font-display);
          font-size: 16px; font-weight: 700;
          color: var(--gold); letter-spacing: 3px;
        }
        .brand-sub {
          font-size: 10px; color: var(--text-faint);
          letter-spacing: 1px; text-transform: uppercase;
          padding: 2px 6px; border: 1px solid var(--border);
          border-radius: 2px;
        }

        .main-nav { display: flex; gap: 4px; flex: 1; }
        .nav-link {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: var(--radius);
          color: var(--text-muted); font-size: 13px;
          letter-spacing: 0.5px; text-transform: uppercase;
          transition: all 0.15s;
        }
        .nav-link:hover { color: var(--text); background: var(--bg-card); }
        .nav-link.active { color: var(--gold); background: rgba(201,168,76,0.08); }

        .header-right { display: flex; align-items: center; gap: 12px; margin-left: auto; }

        .ws-indicator {
          width: 8px; height: 8px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
        }
        .ws-indicator.connected { color: var(--emerald-bright); }
        .ws-indicator.disconnected { color: var(--crimson-bright); animation: pulse 1s infinite; }

        .foundry-btn {
          display: flex; align-items: center; gap: 7px;
          padding: 7px 16px;
          background: linear-gradient(135deg, #8b2020 0%, #5a1010 100%);
          border: 1px solid rgba(196,48,48,0.4);
          border-radius: var(--radius);
          color: #f0d8d8;
          font-family: var(--font-display);
          font-size: 11px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          box-shadow: 0 2px 12px rgba(139,32,32,0.3), inset 0 1px 0 rgba(255,255,255,0.05);
          transition: all 0.2s;
        }
        .foundry-btn:hover {
          background: linear-gradient(135deg, #a82828 0%, #7a1818 100%);
          box-shadow: 0 4px 20px rgba(139,32,32,0.5), inset 0 1px 0 rgba(255,255,255,0.08);
          transform: translateY(-1px);
        }
        .foundry-btn:active { transform: translateY(0); }

        .user-chip {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          font-size: 13px;
        }
        .user-chip-name { color: var(--text); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gm-badge {
          font-family: var(--font-display);
          font-size: 9px; font-weight: 700;
          color: var(--gold); letter-spacing: 1px;
          padding: 1px 5px;
          background: rgba(201,168,76,0.1);
          border: 1px solid var(--gold-dim);
          border-radius: 2px;
        }

        .site-main { flex: 1; max-width: 1200px; margin: 0 auto; width: 100%; padding: 24px; }

        @media (max-width: 768px) {
          .brand-sub, .user-chip-name { display: none; }
          .nav-link span { display: none; }
          .header-inner { gap: 12px; padding: 0 12px; }
          .foundry-btn span { display: none; }
          .site-main { padding: 16px 12px; }
        }
      `}</style>
    </div>
  );
}
