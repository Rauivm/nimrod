import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { X, Swords, User } from 'lucide-react';

/**
 * JoinMissionModal
 *
 * Shows the player's active characters so they can pick one (or join as
 * themselves) before confirming participation in a mission.
 *
 * Props:
 *   mission      – mission object
 *   onClose      – () => void
 *   onJoined     – (result) => void  called with the API response after join
 *   playersFull  – boolean, true → slot is Reserve
 */
export default function JoinMissionModal({ mission, onClose, onJoined, playersFull }) {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState('');   // '' means "no character / as user"
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/me/characters')
      .then(data => {
        setCharacters(data ?? []);
        // Pre-select first character if available
        if (data?.length) setSelectedId(data[0].id);
      })
      .catch(() => setCharacters([]))
      .finally(() => setLoading(false));
  }, []);

  const slotLabel = playersFull ? 'Reserva' : 'Aventureiro';

  const confirm = async () => {
    setSubmitting(true);
    try {
      const body = selectedId ? { characterId: selectedId } : {};
      const result = await api.post(`/missions/${mission.id}/join`, body);
      onJoined?.(result);
      onClose?.();
    } catch (err) {
      alert(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="jm-overlay" role="presentation">
      <div className="jm-modal animate-in">

        {/* Header */}
        <div className="jm-header">
          <div className="jm-header-text">
            <Swords size={15} style={{ color: 'var(--gold)', flexShrink: 0 }} />
            <h3 className="jm-title">Participar como {slotLabel}</h3>
          </div>
          <button onClick={onClose} className="jm-close">
            <X size={15} />
          </button>
        </div>

        {/* Mission name */}
        <div className="jm-mission-name">{mission.title}</div>

        {/* Character picker */}
        <div className="jm-body">
          {loading ? (
            <div className="jm-loading">Carregando personagens...</div>
          ) : (
            <>
              <p className="jm-label">Participar como:</p>

              <div className="jm-options">
                {/* Option: as the user (no character) */}
                <button
                  className={`jm-option ${selectedId === '' ? 'jm-option-selected' : ''}`}
                  onClick={() => setSelectedId('')}
                >
                  <div className="jm-option-token jm-option-token-user">
                    <User size={16} style={{ color: '#fff' }} />
                  </div>
                  <div className="jm-option-info">
                    <span className="jm-option-name">Jogador (sem personagem)</span>
                    <span className="jm-option-sub">Participa com sua conta de jogador</span>
                  </div>
                  <div className={`jm-radio ${selectedId === '' ? 'jm-radio-on' : ''}`} />
                </button>

                {/* Characters */}
                {characters.map(char => (
                  <button
                    key={char.id}
                    className={`jm-option ${selectedId === char.id ? 'jm-option-selected' : ''}`}
                    onClick={() => setSelectedId(char.id)}
                  >
                    <div className="jm-option-token">
                      {char.tokenImg
                        ? <img
                            src={`/api/foundry/assets?path=${encodeURIComponent(char.tokenImg)}`}
                            alt={char.name}
                            className="jm-token-img"
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                        : <span className="jm-token-initial">{char.name[0]}</span>
                      }
                    </div>
                    <div className="jm-option-info">
                      <span className="jm-option-name">{char.name}</span>
                      <span className="jm-option-sub">Nível {char.level}</span>
                    </div>
                    <div className={`jm-radio ${selectedId === char.id ? 'jm-radio-on' : ''}`} />
                  </button>
                ))}

                {characters.length === 0 && !loading && (
                  <div className="jm-no-chars">
                    <span>Você não tem personagens vinculados.</span>
                    <span className="jm-no-chars-hint">Vincule um personagem no seu Perfil para participar com ele.</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="jm-footer">
          <button onClick={onClose} className="jm-btn-cancel" disabled={submitting}>
            Cancelar
          </button>
          <button onClick={confirm} className="jm-btn-confirm" disabled={submitting || loading}>
            {submitting ? 'Confirmando...' : `Entrar como ${slotLabel}`}
          </button>
        </div>
      </div>

      <style>{`
        .jm-overlay {
          position: fixed; inset: 0; z-index: 400;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .jm-modal {
          background: var(--bg-modal); border: 1px solid var(--border-bright);
          border-radius: var(--radius-lg); width: min(100%, 420px);
          max-height: 85vh; display: flex; flex-direction: column;
          box-shadow: var(--shadow-lg); overflow: hidden;
        }
        .jm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .jm-header-text { display: flex; align-items: center; gap: 8px; }
        .jm-title {
          font-family: var(--font-display); font-size: 14px; font-weight: 700;
          color: var(--gold); letter-spacing: 0.8px;
        }
        .jm-close {
          background: none; color: var(--text-muted);
          transition: color 0.15s;
        }
        .jm-close:hover { color: var(--text); }

        .jm-mission-name {
          font-size: 12px; color: var(--text-faint); padding: 8px 18px;
          border-bottom: 1px solid var(--border);
          font-style: italic; flex-shrink: 0;
        }

        .jm-body {
          flex: 1; overflow-y: auto; padding: 14px 18px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .jm-loading { color: var(--text-faint); font-size: 13px; text-align: center; padding: 20px; }
        .jm-label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
          color: var(--text-muted); margin-bottom: 2px;
        }

        .jm-options { display: flex; flex-direction: column; gap: 6px; }
        .jm-option {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 12px; border: 1px solid var(--border);
          border-radius: var(--radius); background: var(--bg-card);
          text-align: left; transition: all 0.15s; cursor: pointer; width: 100%;
        }
        .jm-option:hover { border-color: var(--gold-dim); background: var(--bg-card-hover); }
        .jm-option-selected {
          border-color: var(--gold-dim);
          background: rgba(201,168,76,0.08);
        }

        .jm-option-token {
          width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #2a3060, #4a5090);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          border: 2px solid var(--border);
        }
        .jm-option-token-user {
          background: linear-gradient(135deg, #3a2a20, #6a4a30);
        }
        .jm-token-img { width: 100%; height: 100%; object-fit: cover; }
        .jm-token-initial {
          font-family: var(--font-display); font-weight: 700;
          color: #fff; font-size: 16px;
        }

        .jm-option-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .jm-option-name { font-size: 14px; font-weight: 600; color: var(--text); }
        .jm-option-sub { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }

        .jm-radio {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid var(--border); flex-shrink: 0;
          transition: all 0.15s;
        }
        .jm-radio-on {
          border-color: var(--gold);
          background: var(--gold);
          box-shadow: 0 0 6px rgba(201,168,76,0.4);
        }

        .jm-no-chars {
          display: flex; flex-direction: column; gap: 4px;
          padding: 16px; text-align: center;
          color: var(--text-faint); font-size: 13px;
          border: 1px dashed var(--border); border-radius: var(--radius);
        }
        .jm-no-chars-hint { font-size: 11px; color: var(--text-faint); opacity: 0.7; }

        .jm-footer {
          display: flex; gap: 8px; padding: 12px 18px;
          border-top: 1px solid var(--border); flex-shrink: 0;
          justify-content: flex-end;
        }
        .jm-btn-cancel {
          padding: 8px 16px; background: none;
          border: 1px solid var(--border); color: var(--text-muted);
          border-radius: var(--radius); font-size: 12px; transition: all 0.15s;
        }
        .jm-btn-cancel:hover:not(:disabled) { color: var(--text); border-color: var(--text-muted); }
        .jm-btn-confirm {
          padding: 8px 20px; background: var(--crimson);
          color: #f0d0d0; font-family: var(--font-display);
          font-size: 12px; font-weight: 700; letter-spacing: 1px;
          text-transform: uppercase; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s;
        }
        .jm-btn-confirm:hover:not(:disabled) { background: var(--crimson-bright); }
        .jm-btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
        .jm-btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
