import { useState } from 'react';
import { api } from '../lib/api.js';
import { ChevronDown, ChevronUp, Archive, Edit2, Check, X } from 'lucide-react';

// ── XP progress bar ───────────────────────────────────────────────────────────
function XpBar({ xp, xpNext }) {
  const pct = xpNext > 0 ? Math.min((xp / xpNext) * 100, 100) : 0;
  return (
    <div className="xp-bar-wrap" title={`${xp} / ${xpNext} XP`}>
      <div className="xp-bar-track">
        <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="xp-label">{xp}/{xpNext} XP</span>

      <style>{`
        .xp-bar-wrap { display: flex; flex-direction: column; gap: 3px; }
        .xp-bar-track { height: 5px; border-radius: 3px; background: var(--bg-elevated); overflow: hidden; }
        .xp-bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #c9a84c, #f0d070); transition: width 0.4s ease; }
        .xp-label { font-size: 10px; color: var(--text-faint); font-family: var(--font-mono); }
      `}</style>
    </div>
  );
}

// ── Token image ───────────────────────────────────────────────────────────────
function TokenImg({ src, name, size = 64 }) {
  const [errored, setErrored] = useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';

  // Proxy Foundry images through our backend to avoid CORS
  const proxied = src
    ? src.startsWith('/uploads/')
      ? src
      : `/api/foundry/assets?path=${encodeURIComponent(src.startsWith('http') ? new URL(src).pathname : src)}`
    : null;

  return (
    <div className="token-circle" style={{ width: size, height: size }}>
      {proxied && !errored
        ? <img src={proxied} alt={name} onError={() => setErrored(true)} className="token-img" />
        : <span className="token-initial" style={{ fontSize: size * 0.4 }}>{initial}</span>
      }
      <style>{`
        .token-circle { border-radius: 50%; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #2a3060, #4a5090); border: 2px solid var(--border-bright); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
        .token-img { width: 100%; height: 100%; object-fit: cover; }
        .token-initial { font-family: var(--font-display); font-weight: 700; color: #fff; }
      `}</style>
    </div>
  );
}

// ── Inline biography editor ───────────────────────────────────────────────────
function BiographyEditor({ charId, userId, initial, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(initial ?? '');
  const [loading, setLoading] = useState(false);

  if (!editing) {
    return (
      <div className="bio-view">
        {value
          ? <p className="bio-text">{value}</p>
          : <span className="bio-empty">Sem biografia.</span>
        }
        <button onClick={() => setEditing(true)} className="bio-edit-btn">
          <Edit2 size={11} /> Editar
        </button>
        <style>{`
          .bio-view { display: flex; flex-direction: column; gap: 6px; }
          .bio-text { font-size: 13px; color: var(--text-muted); line-height: 1.6; white-space: pre-wrap; }
          .bio-empty { font-size: 12px; color: var(--text-faint); font-style: italic; }
          .bio-edit-btn { display: flex; align-items: center; gap: 4px; background: none; color: var(--text-faint); font-size: 11px; padding: 2px 0; border: none; transition: color 0.15s; align-self: flex-start; }
          .bio-edit-btn:hover { color: var(--gold); }
        `}</style>
      </div>
    );
  }

  const save = async () => {
    setLoading(true);
    try {
      await api.patch(`/players/${userId}/characters/${charId}`, { biography: value });
      onSaved?.(value);
      setEditing(false);
    } catch (err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div className="bio-editor">
      <textarea
        autoFocus value={value}
        onChange={e => setValue(e.target.value)}
        rows={4} maxLength={2000}
        style={{ fontSize: '13px', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button onClick={() => setEditing(false)} style={{ background: 'none', color: 'var(--text-faint)', fontSize: '12px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <X size={12} />
        </button>
        <button onClick={save} disabled={loading} style={{ background: 'var(--crimson)', color: '#f0d0d0', fontSize: '12px', padding: '4px 12px', fontFamily: 'var(--font-display)', letterSpacing: '0.8px', textTransform: 'uppercase', border: '1px solid rgba(196,48,48,0.3)', borderRadius: 'var(--radius)', opacity: loading ? 0.5 : 1 }}>
          <Check size={12} />
        </button>
      </div>
      <style>{`.bio-editor { display: flex; flex-direction: column; gap: 6px; }`}</style>
    </div>
  );
}

// ── CharacterCard ─────────────────────────────────────────────────────────────
export default function CharacterCard({ character: initialChar, isOwn, isGM, onUpdate }) {
  const [char, setChar]           = useState(initialChar);
  const [expanded, setExpanded]   = useState(false);
  const [retiring, setRetiring]   = useState(false);

  const canEdit = isOwn || isGM;

  const retire = async () => {
    if (!confirm(`Aposentar ${char.name}? Esta ação pode ser revertida pelo GM.`)) return;
    setRetiring(true);
    try {
      // Need the userId — it's on the char object
      await api.patch(`/players/${char.userId}/characters/${char.id}`, { retired: true, active: false });
      onUpdate?.();
    } catch (err) { alert(err.message); }
    setRetiring(false);
  };

  const handleBioSaved = (biography) => {
    setChar(c => ({ ...c, biography }));
  };

  return (
    <div className={`char-card ${char.retired ? 'char-card-retired' : ''}`}>

      {/* ── Card header ──────────────────────────────────────────── */}
      <div className="char-card-header">
        <TokenImg src={char.tokenImg ?? char.portraitImg} name={char.name} size={56} />

        <div className="char-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="char-name">{char.name}</span>
            {char.retired && <span className="retired-tag">Aposentado</span>}
          </div>

          <div className="level-row">
            <span className="level-badge">Nível {char.level}</span>
            {char.lastSyncedAt && (
              <span className="sync-badge" title={`Último sync: ${new Date(char.lastSyncedAt).toLocaleString('pt-BR')}`}>
                Foundry ⟳
              </span>
            )}
          </div>

          <XpBar xp={char.xp} xpNext={char.xpNext} />
        </div>
      </div>

      {/* ── Mission count ─────────────────────────────────────────── */}
      <div className="char-meta">
        <span className="char-meta-item">⚔ {char.missionCount} missão{char.missionCount !== 1 ? 'ões' : ''}</span>
        {char.foundryActorId && (
          <span className="char-meta-item foundry-linked" title="Vinculado ao Foundry">
            🎲 Foundry
          </span>
        )}
      </div>

      {/* ── Expand biography ─────────────────────────────────────── */}
      <button className="char-expand-btn" onClick={() => setExpanded(v => !v)}>
        {expanded ? <><ChevronUp size={12} /> Ocultar detalhes</> : <><ChevronDown size={12} /> Ver detalhes</>}
      </button>

      {expanded && (
        <div className="char-detail">
          {canEdit
            ? (
              <BiographyEditor
                charId={char.id}
                userId={char.userId}
                initial={char.biography}
                onSaved={handleBioSaved}
              />
            )
            : char.biography
              ? <p className="bio-text">{char.biography}</p>
              : <span className="bio-empty">Sem biografia.</span>
          }

          {/* Retire action */}
          {canEdit && !char.retired && (
            <button onClick={retire} disabled={retiring} className="retire-btn">
              <Archive size={12} />
              {retiring ? 'Aposentando...' : 'Aposentar personagem'}
            </button>
          )}
        </div>
      )}

      <style>{`
        .char-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.15s; }
        .char-card:hover { border-color: var(--border-bright); }
        .char-card-retired { opacity: 0.7; }
        .char-card-header { display: flex; gap: 12px; align-items: flex-start; }
        .char-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
        .char-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: 0.5px; }
        .retired-tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-faint); border: 1px solid var(--border); border-radius: 2px; padding: 1px 5px; font-family: var(--font-display); }
        .level-row { display: flex; align-items: center; gap: 6px; }
        .level-badge { font-family: var(--font-display); font-size: 11px; font-weight: 700; color: var(--gold); letter-spacing: 0.5px; }
        .sync-badge { font-size: 9px; color: var(--text-faint); border: 1px solid var(--border); border-radius: 2px; padding: 1px 5px; cursor: help; }
        .char-meta { display: flex; gap: 10px; flex-wrap: wrap; }
        .char-meta-item { font-size: 11px; color: var(--text-faint); }
        .foundry-linked { color: var(--gold); opacity: 0.7; }
        .char-expand-btn { display: flex; align-items: center; gap: 4px; background: none; color: var(--text-faint); font-size: 11px; letter-spacing: 0.5px; font-family: var(--font-display); text-transform: uppercase; border: none; padding: 2px 0; transition: color 0.15s; align-self: flex-start; }
        .char-expand-btn:hover { color: var(--gold); }
        .char-detail { border-top: 1px solid var(--border); padding-top: 10px; display: flex; flex-direction: column; gap: 10px; }
        .bio-text { font-size: 13px; color: var(--text-muted); line-height: 1.6; white-space: pre-wrap; }
        .bio-empty { font-size: 12px; color: var(--text-faint); font-style: italic; }
        .retire-btn { display: flex; align-items: center; gap: 5px; background: none; color: var(--text-faint); font-size: 11px; font-family: var(--font-display); letter-spacing: 0.8px; text-transform: uppercase; border: 1px dashed var(--border); border-radius: var(--radius); padding: 4px 10px; transition: all 0.15s; align-self: flex-start; }
        .retire-btn:hover:not(:disabled) { color: var(--crimson-bright); border-color: var(--crimson); }
        .retire-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
