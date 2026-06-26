import {
  memo, useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth, isGM, isGMPrincipal, roleLabel } from '../contexts/AuthContext.jsx';
import { Flower, Plus, Trash2, X, Skull, Archive, Star, Trophy, Upload } from 'lucide-react';

// ── Tribute tier ──────────────────────────────────────────────────────────────
function getTributeTier(count) {
  if (count <= 0) return { icon: '🪦', label: 'Esquecido',   color: 'var(--text-faint)' };
  if (count < 5)  return { icon: '🌹', label: `${count} Rosa${count > 1 ? 's' : ''}`, color: '#c06060' };
  if (count < 10) return { icon: '💐', label: 'Buquê',       color: '#d08080' };
  if (count < 20) return { icon: '👑', label: 'Honrado',     color: 'var(--gold)' };
  if (count < 40) return { icon: '👑👑', label: 'Lendário', color: '#f0d070' };
  return           { icon: '⭐', label: 'Imortal',            color: '#fff5a0' };
}

// ── Animação de flores ao prestar respeito ────────────────────────────────────
const TRIBUTE_PARTICLES = {
  rose:   { emoji: '🌹', color: '#c06060' },
  bouquet:{ emoji: '💐', color: '#d08080' },
  crown:  { emoji: '👑', color: '#f0d070' },
  candle: { emoji: '🕯️', color: '#f0c060' },
  flower: { emoji: '🪻', color: '#a090d0' },
};

function spawnTributeAnimation(newCount) {
  const container = document.getElementById('tribute-anim-container');
  if (!container) return;

  // Decide quais partículas lançar com base no nível do tribute
  let particles;
  if (newCount >= 20) {
    particles = ['rose', 'crown'];  // rosa + coroa juntos ao virar lendário
  } else if (newCount >= 10) {
    particles = ['crown'];
  } else if (newCount >= 5) {
    particles = ['bouquet', 'flower'];
  } else {
    particles = ['rose', 'candle', 'flower'];
  }

  // Lança 3–5 partículas com offsets aleatórios
  const count = Math.min(3 + Math.floor(Math.random() * 3), particles.length * 2);
  for (let i = 0; i < count; i++) {
    const type = particles[i % particles.length];
    const cfg  = TRIBUTE_PARTICLES[type];

    const el = document.createElement('div');
    el.className = 'tribute-particle';
    el.textContent = cfg.emoji;

    // Posição horizontal aleatória ±20% do centro
    const xOffset = (Math.random() - 0.5) * 40;
    el.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: calc(50% + ${xOffset}vw);
      font-size: ${22 + Math.random() * 16}px;
      pointer-events: none;
      z-index: 9999;
      will-change: transform, opacity;
      animation: tributeFloat ${3 + Math.random() * 1.5}s ease-out forwards;
      animation-delay: ${i * 0.12}s;
      opacity: 0;
    `;

    container.appendChild(el);
    // Remove do DOM após animação
    setTimeout(() => el.remove(), 5500);
  }
}

// ── Imagem de token com fallback ──────────────────────────────────────────────
function TokenImg({ src, fallback, name, size = 60, dead }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [err, setErr]       = useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';

  useEffect(() => {
    // Tenta token_img → portrait_img → imageUrl → null
    const candidates = [src, fallback].filter(Boolean);
    if (!candidates.length) { setImgSrc(null); return; }

    const proxied = (url) => {
      if (!url) return null;
      if (url.startsWith('http')) {
        try { return `/api/foundry/asset?path=${encodeURIComponent(new URL(url).pathname)}`; }
        catch { return url; }
      }
      if (url.startsWith('/uploads/')) return url;
      return `/api/foundry/asset?path=${encodeURIComponent(url)}`;
    };

    setErr(false);
    setImgSrc(proxied(candidates[0]));
  }, [src, fallback]);

  const handleError = () => {
    // Tenta fallback se token_img falhou
    if (!err && fallback) {
      const f = fallback.startsWith('http')
        ? `/api/foundry/asset?path=${encodeURIComponent(new URL(fallback).pathname)}`
        : fallback.startsWith('/uploads/') ? fallback
        : `/api/foundry/asset?path=${encodeURIComponent(fallback)}`;
      setImgSrc(f);
      setErr(true);
    } else {
      setImgSrc(null);
    }
  };

  return (
    <div className="gravestone-token" style={{ '--token-size': `${size}px` }}>
      {imgSrc
        ? <img
            src={imgSrc}
            alt={name}
            onError={handleError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        : <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            color: dead ? '#805050' : 'var(--text-muted)',
            fontSize: size * 0.42,
          }}>{initial}</span>
      }
      {dead && (
        <div className="gravestone-skull-overlay">
          <Skull size={size * 0.28} style={{ color: '#c06060', opacity: 0.85 }} />
        </div>
      )}
    </div>
  );
}

// ── Lápide ────────────────────────────────────────────────────────────────────
function Gravestone({ char, isDead, children }) {
  return (
    <div className={`gravestone-wrap ${isDead ? 'gs-dead' : 'gs-retired'}`}>
      <div className="gravestone-stone">
        <div className="gravestone-arch" />
        <div className="gravestone-body">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Card legacy (tabela characters) ──────────────────────────────────────────
const LegacyCharCard = memo(function LegacyCharCard({ char, onUpdate }) {
  const { user }              = useAuth();
  const [loading, setLoading] = useState(false);
  const [count, setCount]     = useState(Number(char.tribute_count ?? 0));
  const [respected, setRespected] = useState(!!char.tributed_by_me);
  const debounceRef           = useRef(null);
  const tier                  = getTributeTier(count);
  const navigate              = useNavigate();

  const payTribute = useCallback(async () => {
    if (loading) return;
    // Debounce rápido
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const newCount = count + 1;
      setCount(newCount);
      setRespected(true);
      spawnTributeAnimation(newCount);
      try {
        const updated = await api.post(`/cemetery/${char.id}/tribute`, {});
        setCount(Number(updated.tribute_count ?? newCount));
        onUpdate?.({ ...char, ...updated, tribute_count: updated.tribute_count, tributed_by_me: true });
      } catch (e) {
        // Revert se foi erro de cooldown
        if (e.message?.includes('24h') || e.status === 429) {
          setCount(count);
          setRespected(!!char.tributed_by_me);
          // Não alerta — UI muda silenciosamente (já prestou respeito hoje)
        }
      }
      setLoading(false);
    }, 300);
  }, [loading, count, char, onUpdate]);

  const del = async () => {
    if (!confirm(`Remover ${char.name} do cemitério?`)) return;
    try { await api.delete(`/cemetery/${char.id}`); onUpdate?.(); }
    catch (e) { alert(e.message); }
  };

  const canDelete = char.owner_id === user?.id || isGM(user);

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
        {char.owner_name && (
          <span className="cem-owner">
            por{' '}
            {char.owner_id
              ? <button className="inline-link" onClick={() => navigate(`/profile/${char.owner_id}`)}>{char.owner_name}</button>
              : char.owner_name
            }
          </span>
        )}
        {char.description && <p className="cem-desc">{char.description}</p>}
        <div className="cem-meta-row">
          <span className="cem-tribute-count" style={{ color: tier.color }}>
            <Flower size={11} /> {count} respeito{count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="cem-card-actions">
        <button
          onClick={payTribute}
          disabled={loading || respected}
          className={`tribute-btn ${respected ? 'tribute-btn-active' : ''}`}
          title={respected ? 'Respeito prestado (volta em 24h)' : 'Prestar respeito'}
        >
          {respected ? '🥀' : '🌹'}
        </button>
        {canDelete && (
          <button onClick={del} className="cem-delete-btn" title="Remover do cemitério">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
});

// ── Card Foundry (player_characters morto/aposentado) ────────────────────────
const FoundryCharCard = memo(function FoundryCharCard({ char, onUpdate }) {
  const navigate              = useNavigate();
  const [loading, setLoading] = useState(false);
  const [count, setCount]     = useState(Number(char.tribute_count ?? 0));
  const [respected, setRespected] = useState(!!char.tributed_by_me);
  const [uploadingImg, setUploadingImg] = useState(false);
  const fileRef               = useRef(null);
  const debounceRef           = useRef(null);
  const tier                  = getTributeTier(count);
  const isDead                = !!char.dead;

  const imgSrc    = char.tokenImg   || char.portraitImg || char.imageUrl || null;
  const imgFallback = char.portraitImg || char.imageUrl || null;
  const isFoundry = char.origin === 'foundry';

  const payTribute = useCallback(async () => {
    if (loading || respected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const newCount = count + 1;
      setCount(newCount);
      setRespected(true);
      spawnTributeAnimation(newCount);
      try {
        const updated = await api.post(`/cemetery/pc/${char.id}/tribute`, {});
        setCount(Number(updated.tribute_count ?? newCount));
        onUpdate?.({ ...char, tribute_count: updated.tribute_count ?? newCount, tributed_by_me: true });
      } catch (e) {
        if (e.status === 429 || e.message?.includes('24h')) {
          // Silencioso — usuário já prestou hoje
        } else {
          setCount(count);
          setRespected(false);
        }
      }
      setLoading(false);
    }, 300);
  }, [loading, respected, count, char, onUpdate]);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/cemetery/pc/${char.id}/upload-image`, {
        method: 'POST', body: fd,
      });
      if (!res.ok) throw new Error('Upload falhou');
      const data = await res.json();
      onUpdate?.({ ...char, imageUrl: data.imageUrl });
    } catch (err) {
      alert(err.message);
    }
    setUploadingImg(false);
  };

  return (
    <div className={`cem-card cem-card-foundry animate-in ${isDead ? 'cem-card-dead' : 'cem-card-retired'}`}>
      {/* Lápide + token */}
      <div className="cem-card-left">
        <Gravestone char={char} isDead={isDead}>
          <TokenImg src={imgSrc} fallback={imgFallback} name={char.name} size={54} dead={isDead} />
          {/* Upload manual para personagens sem imagem Foundry */}
          {!isFoundry && (
            <button
              className="gravestone-upload-btn"
              onClick={() => fileRef.current?.click()}
              disabled={uploadingImg}
              title="Enviar imagem"
            >
              <Upload size={10} />
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleImageUpload}
          />
        </Gravestone>
      </div>

      <div className="cem-card-body">
        <div className="cem-card-header-row">
          <h3 className="cem-name">{char.name}</h3>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
            {isDead
              ? <span className="cem-status-tag cem-status-dead"><Skull size={9} /> Morto</span>
              : <span className="cem-status-tag cem-status-retired"><Archive size={9} /> Aposentado</span>
            }
            <span className="cem-origin-tag">{isFoundry ? 'Foundry' : 'Manual'}</span>
          </div>
        </div>

        <div className="cem-char-stats">
          <span className="cem-level-badge">Nível {char.level}</span>
          {char.classe && <span className="cem-class-badge">{char.classe}</span>}
          {char.race   && <span className="cem-race-badge">{char.race}</span>}
        </div>

        {char.ownerName && (
          <span className="cem-owner">
            de{' '}
            {char.owner_id
              ? <button className="inline-link" onClick={() => navigate(`/profile/${char.owner_id}`)}>{char.ownerName}</button>
              : char.ownerName
            }
          </span>
        )}

        {char.retireReason && (
          <p className="cem-desc cem-cause">
            {isDead ? '⚰ ' : '📜 '}{char.retireReason}
          </p>
        )}

        {(char.dead_at || char.retiredAt) && (
          <span className="cem-date">
            {isDead ? 'Caiu em' : 'Aposentado em'}{' '}
            {new Date(char.dead_at ?? char.retiredAt).toLocaleDateString('pt-BR')}
          </span>
        )}

        <div className="cem-meta-row">
          <span className="cem-tribute-count" style={{ color: tier.color }}>
            <Star size={10} /> {count} respeito{count !== 1 ? 's' : ''}
            {count >= 10 && <span style={{ marginLeft: 4 }}>{tier.icon}</span>}
          </span>
        </div>
      </div>

      <div className="cem-card-actions">
        <button
          onClick={payTribute}
          disabled={loading || respected}
          className={`tribute-btn ${respected ? 'tribute-btn-active' : ''}`}
          title={respected ? 'Respeito prestado hoje (volta em 24h)' : 'Prestar respeito'}
        >
          {respected ? '🥀' : '🌹'}
        </button>
      </div>
    </div>
  );
});

// ── Modal: criar personagem manual ────────────────────────────────────────────
function CreateCharModal({ onClose, onCreated }) {
  const [form, setForm]       = useState({ name: '', description: '' });
  const [imgFile, setImgFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef               = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('description', form.description);
      if (imgFile) fd.append('image', imgFile);

      await fetch('/api/cemetery', {
        method: 'POST',
        body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      onCreated?.();
      onClose?.();
    } catch (err) { alert(err.message); }
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
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              required placeholder="Ex: Thorin Pedraescura"
            />
          </div>
          <div className="form-group">
            <label>Epitáfio / Causa da morte</label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Como o herói caiu..." rows={3}
            />
          </div>
          <div className="form-group">
            <label>Imagem (opcional)</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button type="button" className="img-upload-btn" onClick={() => fileRef.current?.click()}>
                <Upload size={12} /> {imgFile ? imgFile.name : 'Escolher imagem'}
              </button>
              {imgFile && (
                <button type="button" onClick={() => setImgFile(null)} style={{ color: 'var(--text-faint)', background: 'none', border: 'none', fontSize: '12px' }}>✕ remover</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => setImgFile(e.target.files?.[0] || null)} />
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adicionando...' : 'Adicionar ao Cemitério'}
          </button>
        </form>
      </div>
      <style>{`
        .modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.82); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .modal { background: var(--bg-modal); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); padding: 24px; width: 100%; max-width: 440px; box-shadow: var(--shadow-lg); }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .modal-header h2 { font-family: var(--font-display); font-size: 16px; color: var(--gold); letter-spacing: 1px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
        .img-upload-btn { display: flex; align-items: center; gap: 6px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-muted); font-size: 12px; padding: 7px 12px; border-radius: var(--radius); transition: all 0.15s; }
        .img-upload-btn:hover { border-color: var(--gold-dim); color: var(--gold); }
        .submit-btn { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 10px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); margin-top: 4px; transition: all 0.15s; }
        .submit-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .submit-btn:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
const PAGE_SIZE = 30;

export default function CemeteryPage() {
  const [legacy, setLegacy]             = useState([]);
  const [foundryChars, setFoundryChars] = useState([]);
  const legacyRef                       = useRef([]);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [showCreate, setShowCreate]     = useState(false);
  const [tab, setTab]                   = useState('all');

  useEffect(() => { legacyRef.current = legacy; }, [legacy]);

  const loadLegacy = useCallback(async ({ append = false } = {}) => {
    append ? setLoadingMore(true) : setLoading(true);
    const offset = append ? legacyRef.current.length : 0;
    const data   = await api.get(`/cemetery?limit=${PAGE_SIZE}&offset=${offset}`).catch(() => []);
    setHasMore(data.length === PAGE_SIZE);
    setLegacy(prev => append ? [...prev, ...data.filter(c => !prev.some(e => e.id === c.id))] : data);
    append ? setLoadingMore(false) : setLoading(false);
  }, []);

  const loadFoundryChars = useCallback(async () => {
    const data = await api.get('/cemetery/characters').catch(() => []);
    setFoundryChars(data);
  }, []);

  const load = useCallback(async (opts) => {
    setLoading(true);
    await Promise.all([loadLegacy(opts), loadFoundryChars()]);
    setLoading(false);
  }, [loadLegacy, loadFoundryChars]);

  useEffect(() => { load(); }, [load]);

  // Preload imagens dos personagens Foundry
  useEffect(() => {
    foundryChars.forEach(c => {
      const src = c.tokenImg || c.portraitImg || c.imageUrl;
      if (src) {
        const img = new Image();
        img.src = src.startsWith('http')
          ? `/api/foundry/asset?path=${encodeURIComponent(new URL(src).pathname)}`
          : src.startsWith('/uploads/') ? src
          : `/api/foundry/asset?path=${encodeURIComponent(src)}`;
      }
    });
  }, [foundryChars]);

  const updateLegacy = useCallback((updated) => {
    if (!updated?.id) { load(); return; }
    setLegacy(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
  }, [load]);

  const updateFoundry = useCallback((updated) => {
    if (!updated?.id) return;
    setFoundryChars(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
  }, []);

  const allChars = useMemo(() => [
    ...foundryChars.map(c => ({ ...c, _type: 'foundry' })),
    ...legacy.map(c => ({ ...c, _type: 'legacy' })),
  ].sort((a, b) => (b.tribute_count ?? 0) - (a.tribute_count ?? 0)), [foundryChars, legacy]);

  const shownFoundry = tab === 'legacy'  ? [] : foundryChars;
  const shownLegacy  = tab === 'foundry' ? [] : legacy;

  const topLegendary = allChars.filter(c => (c.tribute_count ?? 0) >= 10).slice(0, 5);

  return (
    <>
      {/* Container de animações — fica fora do flow */}
      <div id="tribute-anim-container" aria-hidden="true" />

      <div className="cem-page">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="cem-page-header">
          <div>
            <h1 className="cem-page-title">🪦 Cemitério</h1>
            <p className="cem-page-sub">Em memória dos heróis caídos</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="create-btn">
            <Plus size={13} /> Adicionar
          </button>
        </div>

        {/* ── Hall da Fama ─────────────────────────────────────────────────── */}
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
                    <TokenImg
                      src={c.tokenImg || c.portraitImg || c.imageUrl}
                      fallback={c.portraitImg}
                      name={c.name} size={28} dead={c.dead}
                    />
                  )}
                  <span className="cem-legendary-name">{c.name}</span>
                  {c.ownerName && c.owner_id && (
                    <Link to={`/profile/${c.owner_id}`} className="cem-legendary-owner">
                      {c.ownerName}
                    </Link>
                  )}
                  <span className="cem-legendary-score" style={{ color: getTributeTier(c.tribute_count ?? 0).color }}>
                    {getTributeTier(c.tribute_count ?? 0).icon} {c.tribute_count ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Legenda ──────────────────────────────────────────────────────── */}
        <div className="tribute-legend">
          <span style={{ color: '#c06060' }}>🌹 1–4 Rosa</span>
          <span style={{ color: '#d08080' }}>💐 5–9 Buquê</span>
          <span style={{ color: 'var(--gold)' }}>👑 10–19 Honrado</span>
          <span style={{ color: '#f0d070' }}>👑👑 20–39 Lendário</span>
          <span style={{ color: '#fff5a0' }}>⭐ 40+ Imortal</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: 'auto' }}>
            ⏳ Respeitos expiram em 3 dias
          </span>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="cem-tabs">
          {[
            { id: 'all',     label: `Todos (${allChars.length})` },
            { id: 'foundry', label: `Foundry (${foundryChars.length})` },
            { id: 'legacy',  label: `Manual (${legacy.length})` },
          ].map(t => (
            <button
              key={t.id}
              className={`cem-tab ${tab === t.id ? 'cem-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Lista ────────────────────────────────────────────────────────── */}
        <div className="cem-list">
          {loading ? (
            [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 'var(--radius-lg)' }} />)
          ) : (allChars.length === 0 && tab === 'all') ? (
            <div className="cem-empty">🕊️ Nenhum herói aqui... por enquanto.</div>
          ) : (
            <>
              {shownFoundry.map(c => (
                <FoundryCharCard key={`fc-${c.id}`} char={c} onUpdate={updateFoundry} />
              ))}
              {shownLegacy.map(c => (
                <LegacyCharCard key={`lc-${c.id}`} char={c} onUpdate={updateLegacy} />
              ))}
            </>
          )}
        </div>

        {!loading && hasMore && tab !== 'foundry' && (
          <button className="load-more-btn" onClick={() => loadLegacy({ append: true })} disabled={loadingMore}>
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </button>
        )}

        {showCreate && <CreateCharModal onClose={() => setShowCreate(false)} onCreated={load} />}

      </div>

      <style>{`
        /* ── Animação de partículas ── */
        @keyframes tributeFloat {
          0%   { opacity: 0;   transform: translateY(0)      scale(0.6); }
          15%  { opacity: 1;   transform: translateY(-8vh)   scale(1.1); }
          60%  { opacity: 0.9; transform: translateY(-45vh)  scale(1);   }
          85%  { opacity: 0.5; transform: translateY(-65vh)  scale(0.9); }
          100% { opacity: 0;   transform: translateY(-80vh)  scale(0.7); }
        }
        #tribute-anim-container {
          position: fixed; inset: 0; pointer-events: none; z-index: 9999;
          overflow: hidden;
        }

        /* ── Layout ── */
        .cem-page { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
        .cem-page-header { display: flex; align-items: flex-start; justify-content: space-between; }
        .cem-page-title { font-family: var(--font-display); font-size: 22px; color: var(--gold); letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 12px rgba(201,168,76,0.3); }
        .cem-page-sub { font-size: 13px; color: var(--text-muted); font-style: italic; margin-top: 4px; }

        .create-btn { display: flex; align-items: center; gap: 5px; background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 7px 14px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; flex-shrink: 0; }
        .create-btn:hover { background: var(--crimson-bright); }

        /* ── Hall da Fama ── */
        .cem-legendary { background: rgba(201,168,76,0.05); border: 1px solid var(--gold-dim); border-radius: var(--radius-lg); padding: 14px 18px; }
        .cem-legendary-header { display: flex; align-items: center; gap: 7px; font-family: var(--font-display); font-size: 12px; font-weight: 700; color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; }
        .cem-legendary-list { display: flex; flex-direction: column; gap: 7px; }
        .cem-legendary-item { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .cem-legendary-item:last-child { border-bottom: none; }
        .cem-rank { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--gold); min-width: 24px; }
        .cem-legendary-name { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; }
        .cem-legendary-owner { font-size: 12px; color: var(--text-muted); text-decoration: none; font-style: italic; transition: color 0.15s; }
        .cem-legendary-owner:hover { color: var(--gold); }
        .cem-legendary-score { font-family: var(--font-display); font-size: 13px; font-weight: 700; }

        /* ── Tribute legend ── */
        .tribute-legend { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; padding: 9px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); font-size: 12px; font-weight: 600; color: var(--text); }

        /* ── Tabs ── */
        .cem-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); }
        .cem-tab { background: none; color: var(--text-faint); font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 8px 18px; border: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
        .cem-tab:hover { color: var(--text-muted); }
        .cem-tab-active { color: var(--gold) !important; border-bottom-color: var(--gold); }

        /* ── Cards ── */
        .cem-list { display: flex; flex-direction: column; gap: 10px; }
        .cem-card { display: flex; align-items: flex-start; gap: 14px; border-radius: var(--radius-lg); padding: 14px 16px; border: 1px solid var(--border); transition: border-color 0.2s, box-shadow 0.2s; }
        .cem-card:hover { border-color: var(--border-bright); box-shadow: 0 2px 12px rgba(0,0,0,0.3); }
        .cem-card-legacy  { background: var(--bg-card); }
        .cem-card-foundry { background: var(--bg-card); }
        .cem-card-dead    { background: rgba(50,8,8,0.35); border-color: rgba(120,30,30,0.35); }
        .cem-card-retired { background: rgba(18,18,28,0.5); }

        .cem-card-left { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .cem-tribute-icon { font-size: 28px; line-height: 1; min-width: 54px; text-align: center; padding-top: 2px; }
        .cem-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

        /* Inline link (owner name) */
        .inline-link { background: none; border: none; padding: 0; color: var(--text-muted); font-size: inherit; font-style: inherit; cursor: pointer; text-decoration: underline dotted; transition: color 0.15s; }
        .inline-link:hover { color: var(--gold); }

        .cem-card-header-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .cem-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: 0.3px; }
        .cem-owner { font-size: 12px; color: var(--text-muted); font-style: italic; }
        .cem-desc  { font-size: 13px; color: var(--text); line-height: 1.55; }
        .cem-cause { color: #c08080; }
        .cem-date  { font-size: 11px; color: var(--text-muted); }

        .cem-char-stats { display: flex; gap: 6px; flex-wrap: wrap; }
        .cem-level-badge { font-family: var(--font-display); font-size: 10px; font-weight: 700; color: var(--gold); padding: 1px 6px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold-dim); border-radius: 3px; }
        .cem-class-badge, .cem-race-badge { font-size: 10px; color: var(--text-muted); padding: 1px 6px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 3px; }

        .cem-status-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; font-family: var(--font-display); font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; }
        .cem-status-dead    { background: rgba(100,20,20,0.45); color: #f09090; border: 1px solid rgba(160,60,60,0.4); }
        .cem-status-retired { background: rgba(40,40,60,0.4); color: var(--text-muted); border: 1px solid var(--border); }
        .cem-origin-tag { font-size: 9px; font-family: var(--font-display); font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(201,168,76,0.1); color: #c9a84c; border: 1px solid rgba(201,168,76,0.22); }

        .cem-meta-row { display: flex; align-items: center; gap: 10px; }
        .cem-tribute-count { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; }

        /* ── Ações ── */
        .cem-card-actions { display: flex; flex-direction: column; gap: 6px; align-items: center; flex-shrink: 0; }
        .tribute-btn {
          font-size: 20px; background: none; border: 1px solid var(--border);
          border-radius: var(--radius); padding: 5px 8px;
          transition: all 0.18s; line-height: 1; cursor: pointer;
        }
        .tribute-btn:hover:not(:disabled) { border-color: var(--crimson-bright); transform: scale(1.12); }
        .tribute-btn-active { border-color: var(--crimson); background: rgba(139,32,32,0.12); cursor: default; }
        .tribute-btn:disabled:not(.tribute-btn-active) { opacity: 0.4; cursor: not-allowed; }
        .cem-delete-btn { background: none; border: none; color: var(--text-faint); padding: 4px; transition: color 0.15s; }
        .cem-delete-btn:hover { color: var(--crimson-bright); }

        /* ── Lápide estilizada ── */
        .gravestone-wrap { display: flex; flex-direction: column; align-items: center; }
        .gravestone-stone {
          position: relative;
          width: 70px;
          background: linear-gradient(160deg, #2a2a32, #1a1a22);
          border: 1.5px solid #3a3a48;
          border-radius: 50% 50% 6px 6px / 60% 60% 6px 6px;
          padding: 10px 6px 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
          display: flex; flex-direction: column; align-items: center; gap: 4px;
        }
        .gs-dead .gravestone-stone {
          border-color: rgba(120,30,30,0.5);
          background: linear-gradient(160deg, #2a1a1a, #1a0e0e);
        }
        .gs-retired .gravestone-stone {
          border-color: rgba(80,80,100,0.5);
        }
        .gravestone-arch {
          position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
          width: 34px; height: 8px;
          border-top: 2px solid rgba(201,168,76,0.25);
          border-radius: 50% 50% 0 0 / 100% 100% 0 0;
        }

        /* Token dentro da lápide */
        .gravestone-token {
          width: var(--token-size); height: var(--token-size);
          border-radius: 50%; overflow: hidden;
          border: 2px solid rgba(255,255,255,0.1);
          display: flex; align-items: center; justify-content: center;
          background: #111;
          position: relative;
          flex-shrink: 0;
        }
        .gravestone-skull-overlay {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.38);
        }
        .gravestone-upload-btn {
          background: rgba(0,0,0,0.5); border: 1px solid var(--border);
          color: var(--text-faint); border-radius: 50%;
          width: 18px; height: 18px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s; cursor: pointer;
        }
        .gravestone-upload-btn:hover { color: var(--gold); border-color: var(--gold-dim); }

        /* ── Misc ── */
        .cem-empty { text-align: center; padding: 52px; color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); font-style: italic; font-size: 14px; }
        .load-more-btn { margin: 14px auto 0; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--text-muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 9px 20px; font-family: var(--font-display); font-size: 12px; letter-spacing: 0.8px; text-transform: uppercase; transition: all 0.15s; }
        .load-more-btn:hover:not(:disabled) { color: var(--gold); border-color: var(--gold-dim); }
        .load-more-btn:disabled { opacity: 0.5; }

        @media (max-width: 560px) {
          .cem-card { padding: 12px; gap: 10px; }
          .gravestone-stone { width: 58px; }
          .tribute-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
          .cem-legendary-owner { display: none; }
        }
      `}</style>
    </>
  );
}