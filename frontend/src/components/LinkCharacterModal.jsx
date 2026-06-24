import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { X, Link, Plus, Unlink, Users } from 'lucide-react';

/**
 * LinkCharacterModal — GM only
 *
 * Tab 1 — "Vincular do Foundry": pick any unlinked actor from player_characters
 * Tab 2 — "Gerenciar Todos":     see all characters + who they're linked to; unlink from here
 * Tab 3 — "Criar Manual":        create a character manually and link to targetUserId
 *
 * Props:
 *   targetUserId  — the player's userId to link/create for
 *   onClose       — () => void
 *   onLinked      — () => void  called after any successful action
 */
export default function LinkCharacterModal({ targetUserId, onClose, onLinked }) {
  const [tab, setTab]               = useState('foundry');
  const [actors, setActors]         = useState([]);
  const [allChars, setAllChars]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [submitting, setSubmitting] = useState(null); // charId being acted on

  // Manual form
  const [name, setName]       = useState('');
  const [level, setLevel]     = useState(1);
  const [xp, setXp]           = useState(0);
  const [xpNext, setXpNext]   = useState(300);

  // Fetch unlinked actors for "Foundry" tab
  useEffect(() => {
    if (tab !== 'foundry') return;
    setLoading(true);
    api.get('/foundry/actors/unlinked')
      .then(setActors)
      .catch(() => setActors([]))
      .finally(() => setLoading(false));
  }, [tab]);

  // Fetch all characters for "Gerenciar" tab
  useEffect(() => {
    if (tab !== 'manage') return;
    setLoading(true);
    api.get('/foundry/actors/all-characters')
      .then(setAllChars)
      .catch(() => setAllChars([]))
      .finally(() => setLoading(false));
  }, [tab]);

  const linkActor = async (actorId) => {
    setSubmitting(actorId);
    try {
      await api.patch(`/players/${targetUserId}/characters/${actorId}/link`, {});
      onLinked?.();
      onClose?.();
    } catch (err) { alert(err.message); }
    setSubmitting(null);
  };

  const unlinkChar = async (charId, charUserId) => {
    if (!confirm('Desvincular este personagem do jogador?')) return;
    setSubmitting(charId);
    try {
      await api.delete(`/players/${charUserId}/characters/${charId}`);
      // Refresh the manage list
      const data = await api.get('/foundry/actors/all-characters');
      setAllChars(data);
      onLinked?.();
    } catch (err) { alert(err.message); }
    setSubmitting(null);
  };

  const relinkChar = async (charId) => {
    setSubmitting(charId);
    try {
      await api.patch(`/players/${targetUserId}/characters/${charId}/link`, {});
      const data = await api.get('/foundry/actors/all-characters');
      setAllChars(data);
      onLinked?.();
    } catch (err) { alert(err.message); }
    setSubmitting(null);
  };

  const createManual = async () => {
    if (!name.trim()) return;
    setSubmitting('manual');
    try {
      await api.post(`/players/${targetUserId}/characters`, {
        name: name.trim(), level, xp, xpNext,
      });
      onLinked?.();
      onClose?.();
    } catch (err) { alert(err.message); }
    setSubmitting(null);
  };

  const TABS = [
    { id: 'foundry', icon: <Link size={12} />, label: 'Do Foundry' },
    { id: 'manage',  icon: <Users size={12} />, label: 'Gerenciar' },
    { id: 'manual',  icon: <Plus size={12} />,  label: 'Manual' },
  ];

  return (
    <div className="lc-overlay" role="presentation">
      <div className="lc-modal animate-in">

        <div className="lc-header">
          <h3 className="lc-title">Gerenciar Personagens</h3>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="lc-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`lc-tab ${tab === t.id ? 'lc-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── Foundry tab ────────────────────────────────────────────────── */}
        {tab === 'foundry' && (
          <div className="lc-content">
            {loading ? (
              <div className="lc-loading">Buscando personagens...</div>
            ) : actors.length === 0 ? (
              <div className="lc-empty">
                <p>Nenhum personagem sem vínculo encontrado.</p>
                <p style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
                  Execute uma sincronização do Foundry primeiro ou use a aba "Gerenciar".
                </p>
              </div>
            ) : (
              <div className="lc-actor-list">
                {actors.map(a => (
                  <button
                    key={a.id}
                    className="lc-actor-row"
                    onClick={() => linkActor(a.id)}
                    disabled={submitting === a.id}
                  >
                    <div className="lc-actor-token">
                      {a.tokenImg
                        ? <img src={`/api/foundry/assets?path=${encodeURIComponent(a.tokenImg)}`} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                        : <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#fff', fontSize: '16px' }}>{a.name[0]}</span>
                      }
                    </div>
                    <div className="lc-actor-info">
                      <span className="lc-actor-name">{a.name}</span>
                      <span className="lc-actor-level">Nível {a.level} · {a.xp} XP</span>
                    </div>
                    {submitting === a.id
                      ? <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>...</span>
                      : <Link size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                    }
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Manage tab ─────────────────────────────────────────────────── */}
        {tab === 'manage' && (
          <div className="lc-content">
            {loading ? (
              <div className="lc-loading">Carregando...</div>
            ) : allChars.length === 0 ? (
              <div className="lc-empty"><p>Nenhum personagem encontrado.</p></div>
            ) : (
              <div className="lc-actor-list">
                {allChars.map(c => {
                  const isLinked   = !!c.userId;
                  const isThisUser = c.userId === targetUserId;
                  const busy       = submitting === c.id;
                  return (
                    <div key={c.id} className={`lc-actor-row lc-actor-row-static ${isThisUser ? 'lc-actor-row-mine' : ''}`}>
                      <div className="lc-actor-token">
                        {c.tokenImg
                          ? <img src={`/api/foundry/assets?path=${encodeURIComponent(c.tokenImg)}`} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                          : <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#fff', fontSize: '14px' }}>{c.name[0]}</span>
                        }
                      </div>
                      <div className="lc-actor-info">
                        <span className="lc-actor-name">{c.name}</span>
                        <span className="lc-actor-level">
                          Nível {c.level}
                          {isLinked
                            ? <> · <span style={{ color: 'var(--gold)', opacity: 0.85 }}>{c.userDisplayName}</span></>
                            : <> · <span style={{ color: 'var(--text-faint)' }}>sem vínculo</span></>
                          }
                        </span>
                      </div>
                      <div className="lc-manage-actions">
                        {/* Vincular ao jogador atual */}
                        {!isThisUser && (
                          <button
                            className="lc-action-btn lc-action-link"
                            onClick={() => relinkChar(c.id)}
                            disabled={busy}
                            title="Vincular a este jogador"
                          >
                            {busy ? '...' : <Link size={12} />}
                          </button>
                        )}
                        {/* Desvincular */}
                        {isLinked && (
                          <button
                            className="lc-action-btn lc-action-unlink"
                            onClick={() => unlinkChar(c.id, c.userId)}
                            disabled={busy}
                            title="Desvincular"
                          >
                            {busy ? '...' : <Unlink size={12} />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Manual tab ─────────────────────────────────────────────────── */}
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
                disabled={submitting === 'manual' || !name.trim()}
                className="lc-submit-btn"
              >
                {submitting === 'manual' ? 'Criando...' : 'Criar e Vincular'}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .lc-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .lc-modal { background: var(--bg-modal); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); width: min(100%, 480px); max-height: 82vh; overflow-y: auto; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
        .lc-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .lc-title { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--gold); letter-spacing: 1px; }
        .lc-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .lc-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 10px 6px; background: none; color: var(--text-muted); font-size: 11px; font-family: var(--font-display); letter-spacing: 0.8px; text-transform: uppercase; border: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
        .lc-tab:hover { color: var(--text); }
        .lc-tab-active { color: var(--gold); border-bottom-color: var(--gold); }
        .lc-content { padding: 14px 18px; overflow-y: auto; }
        .lc-loading, .lc-empty { padding: 24px; text-align: center; color: var(--text-faint); font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
        .lc-actor-list { display: flex; flex-direction: column; gap: 6px; }
        .lc-actor-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); text-align: left; transition: all 0.15s; width: 100%; cursor: pointer; }
        .lc-actor-row:hover:not(:disabled):not(.lc-actor-row-static) { border-color: var(--gold-dim); background: var(--bg-card-hover); }
        .lc-actor-row:disabled { opacity: 0.5; cursor: not-allowed; }
        .lc-actor-row-static { cursor: default; }
        .lc-actor-row-mine { border-color: rgba(201,168,76,0.25); background: rgba(201,168,76,0.04); }
        .lc-actor-token { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #2a3060, #4a5090); flex-shrink: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .lc-actor-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .lc-actor-name { font-size: 13px; font-weight: 600; color: var(--text); }
        .lc-actor-level { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }
        .lc-manage-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .lc-action-btn { width: 28px; height: 28px; border-radius: var(--radius); display: flex; align-items: center; justify-content: center; font-size: 11px; transition: all 0.15s; }
        .lc-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .lc-action-link { background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.2); color: var(--gold); }
        .lc-action-link:hover:not(:disabled) { background: rgba(201,168,76,0.2); }
        .lc-action-unlink { background: rgba(196,48,48,0.1); border: 1px solid rgba(196,48,48,0.2); color: var(--crimson-bright); }
        .lc-action-unlink:hover:not(:disabled) { background: rgba(196,48,48,0.2); }
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