import { Modal } from './ui.jsx';
import { Link } from 'react-router-dom';
import '../styles/join-mission.css';
import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { User } from 'lucide-react';

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
export default function JoinMissionModal({ mission, onClose, onJoined, playersFull, characterOnly=false }) {
  const {user}=useAuth();
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState('');   // '' means "no character / as user"
  const [submitting, setSubmitting] = useState(false);
  const [error,setError]=useState('');

  useEffect(() => {
    api.get('/me/characters')
      .then(data => {
        const eligible=(data ?? []).filter(c=>c.active!==false && !c.dead && !c.retired && c.level>=Number(mission.min_level || 1) && (!mission.max_level || c.level<=mission.max_level));
        setCharacters(eligible);
        // Pre-select first character if available
        if (eligible.length) setSelectedId(eligible[0].id);
      })
      .catch(err => setError(`Não foi possível carregar personagens: ${err.message}`))
      .finally(() => setLoading(false));
  }, [mission.min_level, mission.max_level]);

  const required = Number(mission.min_level)>=4;
  const slotLabel = mission.approval_required ? 'solicitante' : playersFull ? 'Reserva' : 'Aventureiro';

  const confirm = async () => {
    setSubmitting(true);
    try {
      const body = selectedId ? { characterId: selectedId } : {};
      const result = characterOnly
        ? await api.patch(`/missions/${mission.id}/participants/${user.id}`,{...body,action:'CHARACTER'})
        : await api.post(`/missions/${mission.id}/join`, body);
      onJoined?.(result);
      onClose?.();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={characterOnly ? 'Selecionar personagem' : 'Participar da missão'} onClose={onClose} dismissible={!submitting}>
      <div className="jm-content">

        {/* Mission name */}
        <div className="jm-mission-name">{mission.title}</div>

        {/* Character picker */}
        <div className="jm-body">
          {error && <p role="alert" className="ui-error">{error}</p>}
          {loading ? (
            <div className="jm-loading" role="status">Carregando personagens…</div>
          ) : (
            <>
              <p className="jm-label">Participar como:</p>

              <div className="jm-options">
                {/* Option: as the user (no character) */}
                {!required && <button
                  aria-pressed={selectedId === ''} disabled={submitting}
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

                }
                {/* Characters */}
                {characters.map(char => (
                  <button
                    key={char.id} aria-pressed={selectedId === char.id} disabled={submitting}
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
                    <span>Nenhum personagem elegível para esta missão.</span>
                    <span className="jm-no-chars-hint">Confira os níveis da missão e <Link to="/profile" onClick={onClose}>gerencie seus personagens no Perfil</Link>.</span>
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
          <button onClick={confirm} className="jm-btn-confirm" disabled={submitting || loading || (required && !selectedId)}>
            {submitting ? 'Confirmando…' : characterOnly ? 'Salvar personagem' : mission.approval_required ? 'Solicitar inscrição' : `Entrar como ${slotLabel}`}
          </button>
        </div>
      </div>


    </Modal>
  );
}
