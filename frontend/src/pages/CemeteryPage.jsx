import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Flower, Plus, Trash2, X, Skull, Archive, Star, Trophy } from 'lucide-react';

// ── Tribute tier helpers ───────────────────────────────────────────────────
function getTributeTier(count) {
  if (count <= 0)  return { icon: '🪦', label: 'Esquecido',   color: 'var(--text-faint)' };
  if (count < 5)   return { icon: '🌹', label: `${count} Rosa${count > 1 ? 's' : ''}`, color: '#c06060' };
  if (count < 10)  return { icon: '💐', label: 'Buquê',       color: '#d08080' };
  if (count < 20)  return { icon: '👑', label: 'Honrado',     color: 'var(--gold)' };
  if (count < 40)  return { icon: '👑👑', label: 'Lendário', color: '#f0d070' };
  return            { icon: '⭐', label: 'Imortal',            color: '#fff5a0' };
}

// ── Token image ────────────────────────────────────────────────────────────
function TokenImg({ src, name, size = 52, dead }) {
  const [err, setErr] = useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';

  const proxied = src
    ? src.startsWith('http')
      ? `/api/foundry/asset?path=${encodeURIComponent(new URL(src).pathname)}`
      : src.startsWith('/')
        ? `/api/foundry/asset?path=${encodeURIComponent(src)}`
        : src
    : null;

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #1a1010, #2a1a1a)',
      border: `2px solid ${dead ? '#5a2020' : 'var(--border)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', position: 'relative',
      filter: dead ? 'grayscale(0.6) brightness(0.7)' : 'none',
      flexShrink: 0,
    }}>
      {proxied && !err
        ? <img src={proxied} alt={name} onError={() => setErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: dead ? '#805050' : 'var(--text-muted)', fontSize: size * 0.4 }}>{initial}</span>
      }
      {dead && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
          <Skull size={size * 0.35} style={{ color: '#a06060', opacity: 0.9 }} />
        </div>
      )}
    </div>
  );
}

// ── Cemetery card (legacy characters table) ────────────────────────────────
const LegacyCharCard = memo(function LegacyCharCard({ char, onUpdate }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const tier = getTributeTier(char.tribute_count);

  const payTribute = async () => {
    setLoading(true);
    try {
      const updated = await api.post(`/cemetery/${char.id}/tribute`, {});
      onUpdate?.({ ...char, ...updated, tributed_by_me: !char.tributed_by_me });
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const del = async () => {
    if (!confirm(`Remover ${char.name} do cemitério?`)) return;
    try { await api.delete(`/cemetery/${char.id}`); onUpdate?.(); }
    catch (e) { alert(e.message); }
  };

  const canDelete = char.owner_id === user?.id || user?.role === 'GM';

  return (
    <div className="cem-card cem-card-legacy animate-in">
      <div className="cem-card-left">
        <div className="cem-tribute-icon" title={tier.label} style={{ color: tier.color }}>
          {tier.icon}
        </div>
      </div>

      <div className="cem-card-body">
        <div className="cem-card-header-row">
          <h3 className="cem-name">{char.name}</h3>
          <span className="cem-origin-tag">Manual</span>
        </div>
        {char.owner_name && <span className="cem-owner">por {char.owner_name}</span>}
        {char.description && <p className="cem-desc">{char.description}</p>}
        <div className="cem-meta-row">
          <span className="cem-tribute-count" style={{ color: tier.color }}>
            <Flower size={11} /> {char.tribute_count} respeito{char.tribute_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="cem-card-actions">
        <button
          onClick={payTribute} disabled={loading}
          className={`tribute-btn ${char.tributed_by_me ? 'tribute-btn-active' : ''}`}
          title={char.tributed_by_me ? 'Remover respeito' : 'Prestar respeito'}
        >
          {char.tributed_by_me ? '🥀' : '🌹'}
        </button>
        {canDelete && (
          <button onClick={del} className="cem-delete-btn"><Trash2 size={12} /></button>
        )}
      </div>
    </div>
  );
});

// ── Foundry character card (player_characters dead/retired) ────────────────
function FoundryCharCard({ char }) {
  const [respecting, setRespecting] = useState(false);
  const [count, setCount] = useState(char.tribute_count ?? 0);
  const [respected, setRespected] = useState(false);
  const tier = getTributeTier(count);
  const isDead = char.dead ?? char.retired;

  // Tribute via cemetery endpoint using foundry char id
  const respect = async () => {
    setRespecting(true);
    // Optimistic
    const wasRespected = respected;
    setRespected(!wasRespected);
    setCount(c => wasRespected ? Math.max(0, c - 1) : c + 1);
    try {
      await api.post(`/cemetery/pc/${char.id}/tribute`, {});
    } catch {
      // Revert
      setRespected(wasRespected);
      setCount(c => wasRespected ? c + 1 : Math.max(0, c - 1));
    }
    setRespecting(false);
  };

  return (
    <div className={`cem-card cem-card-foundry animate-in ${char.dead ? 'cem-card-dead' : 'cem-card-retired'}`}>
      <div className="cem-card-left">
        <TokenImg src={char.tokenImg ?? char.portraitImg} name={char.name} size={52} dead={char.dead} />
      </div>

      <div className="cem-card-body">
        <div className="cem-card-header-row">
          <h3 className="cem-name">{char.name}</h3>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            {char.dead
              ? <span className="cem-status-tag cem-status-dead"><Skull size={9} /> Morto</span>
              : <span className="cem-status-tag cem-status-retired"><Archive size={9} /> Aposentado</span>
            }
            <span className="cem-origin-tag">Foundry</span>
          </div>
        </div>

        <div className="cem-char-stats">
          <span className="cem-level-badge">Nível {char.level}</span>
          {char.classe && <span className="cem-class-badge">{char.classe}</span>}
          {char.race    && <span className="cem-race-badge">{char.race}</span>}
        </div>

        {char.ownerName && <span className="cem-owner">de {char.ownerName}</span>}

        {char.retireReason && (
          <p className="cem-desc cem-cause">
            {char.dead ? '⚰ ' : '📜 '}{char.retireReason}
          </p>
        )}

        {char.dead_at && (
          <span className="cem-date">
            {char.dead ? 'Caiu em' : 'Aposentado em'} {new Date(char.dead_at ?? char.retiredAt).toLocaleDateString('pt-BR')}
          </span>
        )}

        <div className="cem-meta-row">
          <span className="cem-tribute-count" style={{ color: tier.color }}>
            <Star size={10} /> {count} respeito{count !== 1 ? 's' : ''}
            {count >= 20 && <span style={{ marginLeft: 4 }}>{tier.icon}</span>}
          </span>
        </div>
      </div>

      <div className="cem-card-actions">
        <button
          onClick={respect} disabled={respecting}
          className={`tribute-btn ${respected ? 'tribute-btn-active' : ''}`}
          title={respected ? 'Remover respeito' : 'Prestar respeito'}
        >
          {respected ? '🥀' : '🌹'}
        </button>
      </div>
    </div>
  );
}

// ── Create manual modal ────────────────────────────────────────────────────
function CreateCharModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/cemetery', form);
      onCreated?.();
      onClose?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal animate-in">
        <div className="modal-header">
          <h2>🪦 Adicionar ao Cemitério</h2>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group">
            <label>Nome do Personagem *</label>
            <input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} required placeholder="Ex: Thorin Pedraescura" />
          </div>
          <div className="form-group">
            <label>Epitáfio / Causa da morte</label>
            <textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} placeholder="Como o herói caiu..." rows={3} />
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adicionando...' : 'Adicionar ao Cemitério'}
          </button>
        </form>
      </div>
      <style>{`
        .modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.78); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .modal { background: var(--bg-modal); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); padding: 24px; width: 100%; max-width: 440px; box-shadow: var(--shadow-lg); }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .modal-header h2 { font-family: var(--font-display); font-size: 16px; color: var(--gold); letter-spacing: 1px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
        .submit-btn { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 10px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); margin-top: 4px; transition: all 0.15s; }
        .submit-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .submit-btn:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
const PAGE_SIZE = 30;

export default function CemeteryPage() {
  const [legacy, setLegacy]           = useState([]);
  const [foundryChars, setFoundryChars] = useState([]);
  const legacyRef = useRef([]);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [showCreate, setShowCreate]     = useState(false);
  const [tab, setTab]                   = useState('all'); // 'all' | 'foundry' | 'legacy'

  useEffect(() => { legacyRef.current = legacy; }, [legacy]);

  const loadLegacy = useCallback(async ({ append = false } = {}) => {
    append ? setLoadingMore(true) : setLoading(true);
    const offset = append ? legacyRef.current.length : 0;
    const data = await api.get(`/cemetery?limit=${PAGE_SIZE}&offset=${offset}`).catch(() => []);
    setHasMore(data.length === PAGE_SIZE);
    setLegacy(prev => append ? [...prev, ...data.filter(c => !prev.some(e => e.id === c.id))] : data);
    append ? setLoadingMore(false) : setLoading(false);
  }, []);

  const loadFoundryChars = useCallback(async () => {
    // Fetch dead + retired player_characters from backend
    const data = await api.get('/cemetery/characters').catch(() => []);
    setFoundryChars(data);
  }, []);

  const load = useCallback(async (opts) => {
    await Promise.all([loadLegacy(opts), loadFoundryChars()]);
  }, [loadLegacy, loadFoundryChars]);

  useEffect(() => { load(); }, [load]);

  const updateLegacy = useCallback((updated) => {
    if (!updated?.id) { load(); return; }
    setLegacy(prev => prev.map(c => c.id === updated.id ? updated : c));
  }, [load]);

  // Ranking: combine both sources by tribute count
  const allChars = [
    ...foundryChars.map(c => ({ ...c, _type: 'foundry' })),
    ...legacy.map(c => ({ ...c, tribute_count: c.tribute_count, _type: 'legacy' })),
  ].sort((a, b) => (b.tribute_count ?? 0) - (a.tribute_count ?? 0));

  const shownFoundry = tab === 'legacy' ? [] : foundryChars;
  const shownLegacy  = tab === 'foundry' ? [] : legacy;

  const topLegendary = allChars.filter(c => (c.tribute_count ?? 0) >= 20).slice(0, 3);

  return (
    <div className="cem-page">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="cem-page-header">
        <div>
          <h1 className="cem-page-title">🪦 Cemitério</h1>
          <p className="cem-page-sub">Em memória dos heróis caídos</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="create-btn">
          <Plus size={13} /> Adicionar
        </button>
      </div>

      {/* ── Legendary hall ─────────────────────────────────────────── */}
      {topLegendary.length > 0 && (
        <div className="cem-legendary">
          <div className="cem-legendary-header">
            <Trophy size={14} style={{ color: 'var(--gold)' }} />
            <span>Hall da Fama</span>
          </div>
          <div className="cem-legendary-list">
            {topLegendary.map((c, i) => (
              <div key={c.id} className="cem-legendary-item">
                <span className="cem-rank">#{i + 1}</span>
                {c._type === 'foundry' && (
                  <TokenImg src={c.tokenImg ?? c.portraitImg} name={c.name} size={28} dead={c.dead} />
                )}
                <span className="cem-legendary-name">{c.name}</span>
                <span className="cem-legendary-score" style={{ color: getTributeTier(c.tribute_count ?? 0).color }}>
                  {getTributeTier(c.tribute_count ?? 0).icon} {c.tribute_count ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tribute legend ─────────────────────────────────────────── */}
      <div className="tribute-legend">
        <span style={{ color: '#c06060' }}>🌹 1–4</span>
        <span style={{ color: '#d08080' }}>💐 5–9 Buquê</span>
        <span style={{ color: 'var(--gold)' }}>👑 10–19 Honrado</span>
        <span style={{ color: '#f0d070' }}>👑👑 20–39 Lendário</span>
        <span style={{ color: '#fff5a0' }}>⭐ 40+ Imortal</span>
        <span style={{ color: 'var(--text-faint)', fontSize: '11px', marginLeft: 'auto' }}>Respeitos decaem após 5 dias</span>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="cem-tabs">
        {[
          { id: 'all',     label: `Todos (${allChars.length})` },
          { id: 'foundry', label: `Foundry (${foundryChars.length})` },
          { id: 'legacy',  label: `Manual (${legacy.length})` },
        ].map(t => (
          <button key={t.id} className={`cem-tab ${tab === t.id ? 'cem-tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Character list ─────────────────────────────────────────── */}
      <div className="cem-list">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 90 }} />)
        ) : (allChars.length === 0 && tab === 'all') ? (
          <div className="cem-empty">🕊️ Nenhum herói aqui... por enquanto.</div>
        ) : (
          <>
            {shownFoundry.map(c => <FoundryCharCard key={`fc-${c.id}`} char={c} />)}
            {shownLegacy.map(c => <LegacyCharCard key={`lc-${c.id}`} char={c} onUpdate={updateLegacy} />)}
          </>
        )}
      </div>

      {!loading && hasMore && tab !== 'foundry' && (
        <button className="load-more-btn" onClick={() => loadLegacy({ append: true })} disabled={loadingMore}>
          {loadingMore ? 'Carregando...' : 'Carregar mais'}
        </button>
      )}

      {showCreate && <CreateCharModal onClose={() => setShowCreate(false)} onCreated={load} />}

      <style>{`
        .cem-page { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
        .cem-page-header { display: flex; align-items: flex-start; justify-content: space-between; }
        .cem-page-title { font-family: var(--font-display); font-size: 20px; color: var(--gold); letter-spacing: 3px; text-transform: uppercase; }
        .cem-page-sub { font-size: 13px; color: var(--text-muted); font-style: italic; margin-top: 4px; }

        .create-btn { display: flex; align-items: center; gap: 5px; background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 7px 14px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; }
        .create-btn:hover { background: var(--crimson-bright); }

        /* ── Hall da Fama ─── */
        .cem-legendary { background: rgba(201,168,76,0.06); border: 1px solid var(--gold-dim); border-radius: var(--radius-lg); padding: 12px 16px; }
        .cem-legendary-header { display: flex; align-items: center; gap: 7px; font-family: var(--font-display); font-size: 12px; font-weight: 700; color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 10px; }
        .cem-legendary-list { display: flex; flex-direction: column; gap: 6px; }
        .cem-legendary-item { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
        .cem-rank { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--gold); min-width: 22px; }
        .cem-legendary-name { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; }
        .cem-legendary-score { font-family: var(--font-display); font-size: 13px; font-weight: 700; }

        /* ── Tribute legend ─── */
        .tribute-legend { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 8px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); font-size: 12px; font-weight: 600; }

        /* ── Tabs ─── */
        .cem-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); }
        .cem-tab { background: none; color: var(--text-faint); font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 8px 16px; border: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
        .cem-tab:hover { color: var(--text-muted); }
        .cem-tab-active { color: var(--gold) !important; border-bottom-color: var(--gold); }

        /* ── Card shared ─── */
        .cem-list { display: flex; flex-direction: column; gap: 10px; }
        .cem-card { display: flex; align-items: flex-start; gap: 14px; border-radius: var(--radius-lg); padding: 14px 16px; border: 1px solid var(--border); transition: border-color 0.15s; }
        .cem-card:hover { border-color: var(--border-bright); }
        .cem-card-legacy  { background: var(--bg-card); }
        .cem-card-foundry { background: var(--bg-card); }
        .cem-card-dead    { background: rgba(60,10,10,0.25); border-color: rgba(139,32,32,0.3); }
        .cem-card-retired { background: rgba(20,20,30,0.4); }

        .cem-card-left { flex-shrink: 0; display: flex; align-items: flex-start; }
        .cem-tribute-icon { font-size: 26px; line-height: 1; min-width: 48px; text-align: center; padding-top: 2px; }
        .cem-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

        .cem-card-header-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .cem-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: 0.3px; }
        .cem-owner { font-size: 12px; color: var(--text-muted); font-style: italic; }
        .cem-desc  { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
        .cem-cause { color: #a06060; }
        .cem-date  { font-size: 11px; color: var(--text-faint); }

        .cem-char-stats { display: flex; gap: 6px; flex-wrap: wrap; }
        .cem-level-badge { font-family: var(--font-display); font-size: 10px; font-weight: 700; color: var(--gold); padding: 1px 6px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold-dim); border-radius: 3px; }
        .cem-class-badge, .cem-race-badge { font-size: 10px; color: var(--text-faint); padding: 1px 6px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 3px; }

        /* Status + origin tags */
        .cem-status-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; font-family: var(--font-display); font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; }
        .cem-status-dead    { background: rgba(100,20,20,0.4); color: #e08080; border: 1px solid rgba(160,60,60,0.4); }
        .cem-status-retired { background: rgba(40,40,60,0.4); color: var(--text-muted); border: 1px solid var(--border); }
        /* "Foundry" / "Manual" origin tags — high contrast */
        .cem-origin-tag { font-size: 9px; font-family: var(--font-display); font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(201,168,76,0.12); color: #c9a84c; border: 1px solid rgba(201,168,76,0.25); }

        .cem-meta-row { display: flex; align-items: center; gap: 10px; }
        .cem-tribute-count { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; }

        .cem-card-actions { display: flex; flex-direction: column; gap: 6px; align-items: center; flex-shrink: 0; }
        .tribute-btn { font-size: 20px; background: none; border: 1px solid var(--border); border-radius: var(--radius); padding: 5px 7px; transition: all 0.15s; line-height: 1; }
        .tribute-btn:hover:not(:disabled) { border-color: var(--crimson-bright); transform: scale(1.1); }
        .tribute-btn-active { border-color: var(--crimson); background: rgba(139,32,32,0.1); }
        .tribute-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .cem-delete-btn { background: none; border: none; color: var(--text-faint); padding: 4px; transition: color 0.15s; }
        .cem-delete-btn:hover { color: var(--crimson-bright); }

        .cem-empty { text-align: center; padding: 48px; color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); font-style: italic; }
        .load-more-btn { margin: 14px auto 0; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--text-muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 18px; font-family: var(--font-display); font-size: 12px; letter-spacing: 0.8px; text-transform: uppercase; }
        .load-more-btn:hover:not(:disabled) { color: var(--gold); border-color: var(--gold-dim); }
        .load-more-btn:disabled { opacity: 0.5; }

        @media (max-width: 560px) {
          .cem-card { flex-wrap: wrap; }
          .tribute-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        }
      `}</style>
    </div>
  );
}