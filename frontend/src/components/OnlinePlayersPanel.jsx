import { useState, useEffect, useCallback } from 'react';
import { useWs } from '../contexts/WsContext.jsx';
import { api } from '../lib/api.js';
import { useAuth, roleLabel, isGM, isGMPrincipal } from '../contexts/AuthContext.jsx';
import { Crown, ChevronDown, Link } from 'lucide-react';
import LinkCharacterModal from './LinkCharacterModal.jsx';

function PlayerAvatar({ name, role }) {
  // Support both `displayName` (new) and `name` (legacy) field names.
  const displayName = name;
  const initial = displayName?.[0]?.toUpperCase() ?? '?';
  const playerIsGM = isGM({ role });
  return (
    <div className="op-avatar" style={{
      background: playerIsGM
        ? 'linear-gradient(135deg, #8b2020, #c9a84c)'
        : 'linear-gradient(135deg, #2a3a6a, #4a5a8a)',
    }}>
      {initial}
    </div>
  );
}

function RoleMenu({ player, onPromoted }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);

  const setRole = async (role) => {
    setLoading(true);
    setOpen(false);
    try {
      await api.patch(`/users/${player.id}/role`, { role });
      onPromoted();
    } catch (err) {
      alert(err.message || 'Erro ao alterar papel.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="role-menu-wrap">
      <button
        className="role-menu-trigger"
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        title="Alterar papel"
      >
        <Crown size={11} />
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="role-menu-dropdown">
          <button
            className={`role-menu-item ${isGM(player) ? 'role-menu-active' : ''}`}
            onClick={() => setRole('GM')}
          >
            Mestre (GM)
          </button>
          <button
            className={`role-menu-item ${!isGM(player) ? 'role-menu-active' : ''}`}
            onClick={() => setRole('PLAYER')}
          >
            Jogador
          </button>
        </div>
      )}
    </div>
  );
}

export function OnlinePlayersPanel() {
  const { user } = useAuth();
  const { on, connected } = useWs();
  const [players, setPlayers] = useState([]);
  const [linkTarget, setLinkTarget] = useState(null);

  const fetchOnline = useCallback(async () => {
    try {
      const data = await api.get('/online-users');
      setPlayers(data);
    } catch {
      // non-critical panel — swallow errors silently
    }
  }, []);

  useEffect(() => {
    if (connected) fetchOnline();
  }, [connected, fetchOnline]);

  useEffect(() => {
    const u1 = on('USER_ONLINE',  fetchOnline);
    const u2 = on('USER_OFFLINE', fetchOnline);
    return () => { u1(); u2(); };
  }, [on, fetchOnline]);

  const currentUserIsGM = isGM(user);

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
          players.map(p => {
            // Backend returns `displayName` (new) — fall back to `name` for
            // any cached/legacy payloads that haven't been reloaded yet.
            const displayName = p.displayName ?? p.name ?? '?';
            const isMe = p.id === user?.id;

            return (
              <div key={p.id} className={`op-row ${isMe ? 'op-row-me' : ''}`}>
                <div className="op-avatar-wrap">
                  <PlayerAvatar name={displayName} role={p.role} />
                  <span className="op-dot" />
                </div>

                <div className="op-info">
                  <span className="op-name">
                    {displayName}
                    {isMe ? ' (você)' : ''}
                  </span>
                  <span className="op-role-label">{roleLabel(p.role)}</span>
                  {isGM(p) && <span className="op-gm-badge">GM</span>}
                </div>

                {/* GM can change any player's role, including themselves */}
                {currentUserIsGM && (
                  <div className="op-gm-actions">
                    <button
                      className="link-char-trigger"
                      onClick={() => setLinkTarget(p)}
                      title="Vincular personagem"
                    >
                      <Link size={11} />
                    </button>
                    <RoleMenu player={p} onPromoted={fetchOnline} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {linkTarget && (
        <LinkCharacterModal
          targetUserId={linkTarget.id}
          onClose={() => setLinkTarget(null)}
          onLinked={() => setLinkTarget(null)}
        />
      )}

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
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .op-title {
          font-family: var(--font-display);
          font-size: 11px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: var(--gold);
        }
        .op-count {
          font-size: 11px; font-weight: 700;
          color: var(--emerald-bright);
          background: rgba(42,138,88,0.15);
          border: 1px solid rgba(42,138,88,0.3);
          border-radius: 10px; padding: 1px 7px;
          font-family: var(--font-mono);
        }

        .op-list {
          padding: 8px 0;
          max-height: 320px;
          overflow-y: auto;
        }
        .op-empty {
          padding: 16px 14px;
          font-size: 12px; color: var(--text-faint);
          font-style: italic; text-align: center;
        }

        .op-row {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 14px 6px 14px;
          transition: background 0.1s;
          position: relative;
        }
        .op-row:hover { background: var(--bg-card-hover); }
        .op-row-me { background: rgba(201,168,76,0.04); }

        .op-avatar-wrap { position: relative; flex-shrink: 0; }
        .op-avatar {
          width: 30px; height: 30px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display);
          font-size: 12px; font-weight: 700; color: #fff;
        }
        .op-dot {
          position: absolute; bottom: 0; right: 0;
          width: 9px; height: 9px; border-radius: 50%;
          background: var(--emerald-bright);
          border: 2px solid var(--bg-card);
          box-shadow: 0 0 6px rgba(42,138,88,0.6);
        }

        .op-info {
          display: flex; align-items: center; gap: 5px;
          min-width: 0; flex: 1;
        }
        .op-name {
          font-size: 13px; color: var(--text);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .op-role-label {
          font-size: 10px; color: var(--text-faint);
          font-family: var(--font-display);
          letter-spacing: 0.5px; text-transform: uppercase;
          flex-shrink: 0;
        }
        .op-gm-badge {
          font-family: var(--font-display);
          font-size: 8px; font-weight: 700;
          color: var(--gold); letter-spacing: 1px;
          padding: 1px 4px;
          background: rgba(201,168,76,0.1);
          border: 1px solid var(--gold-dim);
          border-radius: 2px; flex-shrink: 0;
        }
        .op-gm-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
        .link-char-trigger {
          display: flex; align-items: center; justify-content: center;
          color: var(--text-faint); background: none;
          border: 1px solid transparent; border-radius: var(--radius);
          padding: 4px; transition: all 0.15s;
        }
        .link-char-trigger:hover { color: var(--gold); border-color: var(--gold-dim); background: rgba(201,168,76,0.06); }

        /* ── Role menu ─────────────────────────────────────── */
        .role-menu-wrap {
          position: relative; flex-shrink: 0; margin-left: auto;
        }
        .role-menu-trigger {
          display: flex; align-items: center; gap: 2px;
          background: none;
          color: var(--text-faint);
          padding: 3px 5px; border-radius: var(--radius);
          border: 1px solid transparent;
          transition: all 0.15s;
        }
        .role-menu-trigger:hover {
          color: var(--gold); border-color: var(--gold-dim);
          background: rgba(201,168,76,0.06);
        }
        .role-menu-trigger:disabled { opacity: 0.4; cursor: not-allowed; }

        .role-menu-dropdown {
          position: absolute; right: 0; top: calc(100% + 4px);
          background: var(--bg-elevated);
          border: 1px solid var(--border-bright);
          border-radius: var(--radius);
          box-shadow: var(--shadow-lg);
          z-index: 200;
          min-width: 130px;
          overflow: hidden;
        }
        .role-menu-item {
          display: block; width: 100%;
          padding: 8px 12px; text-align: left;
          background: none; color: var(--text-muted);
          font-size: 12px; font-family: var(--font-display);
          letter-spacing: 0.5px; text-transform: uppercase;
          border: none; transition: all 0.1s;
        }
        .role-menu-item:hover { background: var(--bg-card-hover); color: var(--text); }
        .role-menu-active { color: var(--gold) !important; }
      `}</style>
    </aside>
  );
}