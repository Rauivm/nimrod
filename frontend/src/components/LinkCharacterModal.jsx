import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { X, Link, Plus } from 'lucide-react';

/**
 * LinkCharacterModal
 *
 * GM workflow:
 *  Tab 1 — "Vincular do Foundry": pick an unlinked actor from player_characters
 *  Tab 2 — "Criar Manual": fill name/level/xp directly
 *
 * Both link to `targetUserId`.
 */
export default function LinkCharacterModal({ targetUserId, onClose, onLinked }) {
  const [tab, setTab]           = useState('foundry'); // 'foundry' | 'manual'
  const [actors, setActors]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Manual form
  const [name, setName]   = useState('');
  const [level, setLevel] = useState(1);
  const [xp, setXp]       = useState(0);
  const [xpNext, setXpNext] = useState(300);

  useEffect(() => {
    if (tab !== 'foundry') return;
    setLoading(true);
    api.get('/foundry/actors/unlinked')
      .then(setActors)
      .catch(() => setActors([]))
      .finally(() => setLoading(false));
  }, [tab]);

  const linkActor = async (actorId) => {
    setSubmitting(true);
    try {
      await api.patch(`/players/${targetUserId}/characters/${actorId}`, { userId: targetUserId });
      onLinked?.();
      onClose?.();
    } catch (err) { alert(err.message); }
    setSubmitting(false);
  };

  const createManual = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/players/${targetUserId}/characters`, {
        name: name.trim(), level, xp, xpNext,
      });
      onLinked?.();
      onClose?.();
    } catch (err) { alert(err.message); }
    setSubmitting(false);
  };

  return (
    <div className="lc-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="lc-modal animate-in">

        <div className="lc-header">
          <h3 className="lc-title">Vincular Personagem</h3>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="lc-tabs">
          <button className={`lc-tab ${tab === 'foundry' ? 'lc-tab-active' : ''}`} onClick={() => setTab('foundry')}>
            <Link size={12} /> Do Foundry
          </button>
          <button className={`lc-tab ${tab === 'manual' ? 'lc-tab-active' : ''}`} onClick={() => setTab('manual')}>
            <Plus size={12} /> Manual
          </button>
        </div>

        {/* Foundry tab */}
        {tab === 'foundry' && (
          <div className="lc-content">
            {loading ? (
              <div className="lc-loading">Buscando personagens...</div>
            ) : actors.length === 0 ? (
              <div className="lc-empty">
                <p>Nenhum personagem sem vínculo encontrado.</p>
                <p style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
                  Execute uma sincronização do Foundry primeiro.
                </p>
              </div>
            ) : (
              <div className="lc-actor-list">
                {actors.map(a => (
                  <button
                    key={a.id}
                    className="lc-actor-row"
                    onClick={() => linkActor(a.id)}
                    disabled={submitting}
                  >
                    <div className="lc-actor-token">
                      {a.tokenImg
                        ? <img src={`/api/foundry/asset?path=${encodeURIComponent(a.tokenImg)}`} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                        : <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#fff', fontSize: '16px' }}>{a.name[0]}</span>
                      }
                    </div>
                    <div className="lc-actor-info">
                      <span className="lc-actor-name">{a.name}</span>
                      <span className="lc-actor-level">Nível {a.level} · {a.xp} XP</span>
                    </div>
                    <Link size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Manual tab */}
        {tab === 'manual' && (
          <div className="lc-content">
            <div className="lc-form">
              <div className="lc-form-group">
                <label>Nome *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome do personagem" maxLength={100} />
              </div>
              <div className="lc-form-row">
                <div className="lc-form-group">
                  <label>Nível</label>
                  <input type="number" min={1} max={20} value={level} onChange={e => setLevel(parseInt(e.target.value) || 1)} />
                </div>
                <div className="lc-form-group">
                  <label>XP atual</label>
                  <input type="number" min={0} value={xp} onChange={e => setXp(parseInt(e.target.value) || 0)} />
                </div>
                <div className="lc-form-group">
                  <label>XP próx. nível</label>
                  <input type="number" min={1} value={xpNext} onChange={e => setXpNext(parseInt(e.target.value) || 300)} />
                </div>
              </div>
              <button
                onClick={createManual}
                disabled={submitting || !name.trim()}
                className="lc-submit-btn"
              >
                {submitting ? 'Criando...' : 'Criar e Vincular'}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .lc-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .lc-modal { background: var(--bg-modal); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); width: min(100%, 440px); max-height: 80vh; overflow-y: auto; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
        .lc-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .lc-title { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--gold); letter-spacing: 1px; }
        .lc-tabs { display: flex; border-bottom: 1px solid var(--border); }
        .lc-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: none; color: var(--text-muted); font-size: 12px; font-family: var(--font-display); letter-spacing: 0.8px; text-transform: uppercase; border: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
        .lc-tab:hover { color: var(--text); }
        .lc-tab-active { color: var(--gold); border-bottom-color: var(--gold); }
        .lc-content { padding: 16px 20px; }
        .lc-loading, .lc-empty { padding: 24px; text-align: center; color: var(--text-faint); font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
        .lc-actor-list { display: flex; flex-direction: column; gap: 6px; }
        .lc-actor-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); text-align: left; transition: all 0.15s; }
        .lc-actor-row:hover:not(:disabled) { border-color: var(--gold-dim); background: var(--bg-card-hover); }
        .lc-actor-row:disabled { opacity: 0.5; cursor: not-allowed; }
        .lc-actor-token { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #2a3060, #4a5090); flex-shrink: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .lc-actor-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .lc-actor-name { font-size: 14px; font-weight: 600; color: var(--text); }
        .lc-actor-level { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }
        .lc-form { display: flex; flex-direction: column; gap: 12px; }
        .lc-form-group { display: flex; flex-direction: column; gap: 5px; }
        .lc-form-group label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
        .lc-form-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .lc-submit-btn { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 9px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; }
        .lc-submit-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .lc-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        @media (max-width: 480px) { .lc-form-row { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
