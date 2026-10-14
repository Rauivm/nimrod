import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

export default function JoinModal({ activity, onClose, onJoined }) {
  const isMana = activity.rules?.execution_mode === 'mana';
  const [characters, setCharacters] = useState([]);
  const [selectedCharId, setSelectedCharId] = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [rollResult, setRollResult] = useState(null); // { rolls: { dice, modifier, total }, contribution }

  useEffect(() => {
    api.get('/me/characters')
      .then(chars => {
        const eligible = chars.filter(c => c.active && !c.retired && !c.dead);
        setCharacters(eligible);
        if (eligible.length > 0) {
          setSelectedCharId(eligible[0].id);
        }
        setLoading(false);
      })
      .catch(err => {
        setError('Erro ao carregar seus personagens.');
        setLoading(false);
      });
  }, []);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!selectedCharId) return;

    setJoining(true);
    setError('');
    try {
      const res = await api.post(`/sidequests/${activity.id}/join`, { character_id: selectedCharId });
      setRollResult(res);
    } catch (err) {
      setError(err.message || 'Falha ao se inscrever.');
      setJoining(false);
    }
  };

  const handleFinish = () => {
    onJoined();
    onClose();
  };

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="modal-content" style={{
        background: 'var(--bg-modal)', border: '1px solid var(--border-bright)',
        padding: '24px', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '450px',
        boxShadow: 'var(--shadow-lg)', maxHeight: '90dvh', overflowY: 'auto'
      }}>
        {rollResult ? (
          <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', marginBottom: '16px', fontSize: '20px' }}>
              {isMana ? 'Personagem inscrito' : 'Rolagem de Inscrição!'}
            </h3>
            
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              {isMana ? rollResult.characterName : 'Personagem inscrito com sucesso. Veja o resultado do seu teste:'}
            </div>

            {!isMana && <div style={{
              background: 'rgba(201,168,76,0.05)', border: '1px solid var(--border)',
              padding: '16px', borderRadius: 'var(--radius)', marginBottom: '24px',
              display: 'flex', justifyContent: 'space-around', alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dado (d20)</div>
                <div style={{ fontSize: '24px', color: 'var(--text)', fontWeight: 'bold' }}>{rollResult.rolls?.dice}</div>
              </div>
              <div style={{ fontSize: '20px', color: 'var(--text-muted)' }}>+</div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Modificador</div>
                <div style={{ fontSize: '24px', color: 'var(--text)', fontWeight: 'bold' }}>{rollResult.rolls?.modifier}</div>
              </div>
              <div style={{ fontSize: '20px', color: 'var(--text-muted)' }}>=</div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--gold)', textTransform: 'uppercase', fontWeight: 600 }}>Total</div>
                <div style={{ fontSize: '24px', color: 'var(--gold-bright)', fontWeight: 'bold' }}>{rollResult.rolls?.total}</div>
              </div>
            </div>}

            {!isMana && <div style={{ fontSize: '15px', marginBottom: '24px' }}>
              Sua contribuição calculada é de <strong style={{ color: 'var(--gold-bright)' }}>{rollResult.contribution}</strong> pontos para a meta.
            </div>}

            <button onClick={handleFinish} className="btn-gold" style={{
              width: '100%', padding: '10px', background: 'var(--gold)', color: 'var(--bg)',
              fontFamily: 'var(--font-display)', fontWeight: 700, borderRadius: 'var(--radius)',
              letterSpacing: '1px'
            }}>
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleJoin}>
            <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', marginBottom: '12px', fontSize: '20px' }}>
              Inscrever-se em {activity.title}
            </h3>
            
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
              {isMana ? 'Selecione seu personagem para a aventura no jogo 2D.' : 'Selecione o personagem que irá participar desta atividade. O teste de atributo será realizado automaticamente.'}
            </p>

            {error && (
              <div style={{
                color: 'var(--crimson-bright)', background: 'rgba(125,36,36,0.1)',
                border: '1px solid rgba(166,58,52,0.3)', padding: '10px 12px',
                fontSize: '13px', borderRadius: 'var(--radius)', marginBottom: '16px'
              }}>
                ⚠️ {error}
              </div>
            )}

            {loading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '20px 0', textAlign: 'center' }}>
                Carregando personagens...
              </div>
            ) : characters.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '20px 0', textAlign: 'center' }}>
                Você não possui nenhum personagem ativo vinculado ao seu usuário.
              </div>
            ) : (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Escolha o Personagem
                </label>
                <select
                  value={selectedCharId}
                  onChange={(e) => setSelectedCharId(e.target.value)}
                  disabled={joining}
                  required
                  style={{
                    background: 'var(--bg-field)', color: 'var(--text)', border: '1px solid var(--border-field)',
                    borderRadius: 'var(--radius)', padding: '10px', width: '100%', fontSize: '15px'
                  }}
                >
                  {characters.map(char => (
                    <option key={char.id} value={char.id}>
                      {char.name} (Nív. {char.level} {char.class})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={joining}
                style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  padding: '10px 16px', borderRadius: 'var(--radius)', fontSize: '13px',
                  fontFamily: 'var(--font-display)', fontWeight: 600
                }}
              >
                Cancelar
              </button>
              
              <button
                type="submit"
                disabled={joining || characters.length === 0}
                style={{
                  background: joining ? 'var(--border)' : 'var(--gold)',
                  color: joining ? 'var(--text-muted)' : 'var(--bg)',
                  padding: '10px 20px', borderRadius: 'var(--radius)', fontSize: '13px',
                  fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.5px'
                }}
              >
                {joining ? 'Entrando...' : 'Inscrever'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
