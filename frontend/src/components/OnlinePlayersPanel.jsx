import { useState, useEffect, useCallback } from 'react';
import { useWs } from '../contexts/WsContext.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

function PlayerAvatar({ name, role }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const isGM = role === 'GM';
  return (
    <div className="op-avatar" style={{
      background: isGM
        ? 'linear-gradient(135deg, #8b2020, #c9a84c)'
        : 'linear-gradient(135deg, #2a3a6a, #4a5a8a)',
    }}>
      {initial}
    </div>
  );
}

export function OnlinePlayersPanel() {
  const { user } = useAuth();
  const { on, connected } = useWs();
  const [players, setPlayers] = useState([]);

  const fetchOnline = useCallback(async () => {
    try {
      const data = await api.get('/online-users');
      setPlayers(data);
    } catch {
      // silently ignore — panel is non-critical
    }
  }, []);

  // Initial fetch + re-fetch on reconnect
  useEffect(() => {
    if (connected) fetchOnline();
  }, [connected, fetchOnline]);

  // Subscribe to presence events for instant updates
  useEffect(() => {
    const unsub1 = on('USER_ONLINE',  fetchOnline);
    const unsub2 = on('USER_OFFLINE', fetchOnline);
    return () => { unsub1(); unsub2(); };
  }, [on, fetchOnline]);

  return (
    <aside className="op-panel">
      <div className="op-header">
        <span className="op-title">Jogadores Online</span>
        <span className="op-count">{players.length}</span>
      </div>

      <div className="op-list">
        {players.length === 0 ? (
          <div className="op-empty">Nenhum aventureiro online</div>
        ) : (
          players.map(p => (
            <div key={p.id} className={`op-row ${p.id === user?.id ? 'op-row-me' : ''}`}>
              <div className="op-avatar-wrap">
                <PlayerAvatar name={p.name} role={p.role} />
                <span className="op-dot" />
              </div>
              <div className="op-info">
                <span className="op-name">{p.name}{p.id === user?.id ? ' (você)' : ''}</span>
                {p.role === 'GM' && <span className="op-gm-badge">GM</span>}
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .op-panel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          overflow: hidden;
          position: sticky;
          top: 72px;
        }

        .op-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .op-title {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--gold);
        }
        .op-count {
          font-size: 11px;
          font-weight: 700;
          color: var(--emerald-bright);
          background: rgba(42,138,88,0.15);
          border: 1px solid rgba(42,138,88,0.3);
          border-radius: 10px;
          padding: 1px 7px;
          font-family: var(--font-mono);
        }

        .op-list {
          padding: 8px 0;
          max-height: 320px;
          overflow-y: auto;
        }
        .op-empty {
          padding: 16px 14px;
          font-size: 12px;
          color: var(--text-faint);
          font-style: italic;
          text-align: center;
        }

        .op-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 14px;
          transition: background 0.1s;
        }
        .op-row:hover { background: var(--bg-card-hover); }
        .op-row-me { background: rgba(201,168,76,0.04); }

        .op-avatar-wrap { position: relative; flex-shrink: 0; }
        .op-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          color: #fff;
        }
        .op-dot {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--emerald-bright);
          border: 2px solid var(--bg-card);
          box-shadow: 0 0 6px rgba(42,138,88,0.6);
        }

        .op-info {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .op-name {
          font-size: 13px;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .op-gm-badge {
          font-family: var(--font-display);
          font-size: 8px;
          font-weight: 700;
          color: var(--gold);
          letter-spacing: 1px;
          padding: 1px 4px;
          background: rgba(201,168,76,0.1);
          border: 1px solid var(--gold-dim);
          border-radius: 2px;
          flex-shrink: 0;
        }
      `}</style>
    </aside>
  );
}
