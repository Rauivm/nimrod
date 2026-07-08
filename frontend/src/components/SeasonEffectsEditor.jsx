/**
 * SeasonEffectsEditor.jsx
 *
 * Editor de efeitos mecânicos de estação, visível só para GM na página
 * /calendar. Efeitos são balanceamento de jogo — o GM edita livremente,
 * sem precisar de deploy.
 *
 * Três tipos de efeito:
 *   'check'  → perícia + vantagem/desvantagem
 *   'price'  → categoria de preço + multiplicador
 *   'custom' → só texto de lore, sem mecânica
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { SEASONS } from '../config/calendarSeasons.js';
import { getEffectIcon, getEffectBadge } from '../config/seasonEffectDisplay.js';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, X, Loader2 } from 'lucide-react';

const SEASON_TABS = Object.values(SEASONS); // [{key, name, accentColor, icon}, ...]

const KIND_LABEL = { check: 'Perícia', price: 'Preço', custom: 'Só texto' };

function emptyForm() {
  return { kind: 'custom', label: '', skill: '', mode: 'disadvantage', priceCategory: '', priceMultiplier: '' };
}

function formToPayload(seasonKey, form) {
  const payload = { seasonKey, kind: form.kind, label: form.label.trim() };
  if (form.kind === 'check') {
    payload.skill = form.skill.trim();
    payload.mode = form.mode;
  }
  if (form.kind === 'price') {
    payload.priceCategory = form.priceCategory.trim();
    payload.priceMultiplier = parseFloat(form.priceMultiplier);
  }
  return payload;
}

function EffectForm({ seasonKey, initial, onCancel, onSubmit, busy }) {
  const [form, setForm] = useState(initial || emptyForm());
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const valid =
    form.label.trim().length > 0 &&
    (form.kind !== 'check' || form.skill.trim().length > 0) &&
    (form.kind !== 'price' || (form.priceCategory.trim().length > 0 && parseFloat(form.priceMultiplier) > 0));

  return (
    <div className="sfe-form">
      <div className="sfe-form-row">
        <select value={form.kind} onChange={set('kind')} className="sfe-select">
          <option value="custom">Só texto (lore)</option>
          <option value="check">Perícia (vantagem/desvantagem)</option>
          <option value="price">Preço (multiplicador)</option>
        </select>
      </div>

      <input
        type="text"
        placeholder="Texto exibido (ex: Dificuldade de rastreio)"
        value={form.label}
        onChange={set('label')}
        className="sfe-input"
      />

      {form.kind === 'check' && (
        <div className="sfe-form-row">
          <input
            type="text"
            placeholder="Perícia (ex: rastreio)"
            value={form.skill}
            onChange={set('skill')}
            className="sfe-input"
          />
          <select value={form.mode} onChange={set('mode')} className="sfe-select">
            <option value="disadvantage">Desvantagem</option>
            <option value="advantage">Vantagem</option>
          </select>
        </div>
      )}

      {form.kind === 'price' && (
        <div className="sfe-form-row">
          <input
            type="text"
            placeholder="Categoria (ex: alimento)"
            value={form.priceCategory}
            onChange={set('priceCategory')}
            className="sfe-input"
          />
          <input
            type="number"
            step="0.05"
            min="0.01"
            placeholder="Multiplicador (ex: 1.3 = +30%)"
            value={form.priceMultiplier}
            onChange={set('priceMultiplier')}
            className="sfe-input sfe-input-narrow"
          />
        </div>
      )}

      <div className="sfe-form-actions">
        <button className="sfe-btn-ghost" onClick={onCancel} type="button">Cancelar</button>
        <button
          className="sfe-btn-primary"
          type="button"
          disabled={!valid || busy}
          onClick={() => onSubmit(formToPayload(seasonKey, form))}
        >
          {busy ? <Loader2 size={13} className="sfe-spin" /> : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

export function SeasonEffectsEditor({ currentSeasonKey }) {
  const [seasonKey, setSeasonKey] = useState(currentSeasonKey || SEASON_TABS[0].key);
  const [effects, setEffects] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback((key) => {
    api.get(`/world/calendar/effects/${key}`)
      .then((data) => { setEffects(data); setError(null); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(seasonKey); setEditingId(null); setAdding(false); }, [seasonKey, load]);

  async function handleCreate(payload) {
    setBusy(true);
    try {
      await api.post('/world/calendar/effects', payload);
      setAdding(false);
      load(seasonKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id, payload) {
    setBusy(true);
    try {
      await api.patch(`/world/calendar/effects/${id}`, payload);
      setEditingId(null);
      load(seasonKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    setBusy(true);
    try {
      await api.delete(`/world/calendar/effects/${id}`);
      load(seasonKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(id, direction) {
    setBusy(true);
    try {
      await api.post(`/world/calendar/effects/${id}/move`, { direction });
      load(seasonKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const activeSeason = SEASON_TABS.find((s) => s.key === seasonKey);

  return (
    <div className="sfe-panel">
      <div className="sfe-header">
        <span className="sfe-title">Efeitos das estações</span>
        <span className="sfe-hint">Balanceamento — edite à vontade</span>
      </div>

      <div className="sfe-tabs">
        {SEASON_TABS.map((s) => {
          const Icon = s.icon;
          const active = s.key === seasonKey;
          return (
            <button
              key={s.key}
              className={active ? 'sfe-tab sfe-tab-active' : 'sfe-tab'}
              style={active ? { borderColor: s.accentColor, color: s.accentColor } : undefined}
              onClick={() => setSeasonKey(s.key)}
            >
              <Icon size={13} /> {s.name}
            </button>
          );
        })}
      </div>

      {error && <p className="sfe-error">{error}</p>}

      <div className="sfe-list">
        {effects === null && !error && <p className="sfe-empty">Carregando…</p>}
        {effects && effects.length === 0 && <p className="sfe-empty">Nenhum efeito cadastrado para {activeSeason.name}.</p>}
        {effects && effects.map((effect, i) => {
          if (editingId === effect.id) {
            return (
              <EffectForm
                key={effect.id}
                seasonKey={seasonKey}
                busy={busy}
                initial={{
                  kind: effect.kind,
                  label: effect.label,
                  skill: effect.skill || '',
                  mode: effect.mode || 'disadvantage',
                  priceCategory: effect.priceCategory || '',
                  priceMultiplier: effect.priceMultiplier != null ? String(effect.priceMultiplier) : '',
                }}
                onCancel={() => setEditingId(null)}
                onSubmit={(payload) => handleUpdate(effect.id, payload)}
              />
            );
          }

          const Icon = getEffectIcon(effect);
          const badge = getEffectBadge(effect);

          return (
            <div key={effect.id} className="sfe-row">
              <Icon size={14} style={{ color: activeSeason.accentColor, flexShrink: 0 }} />
              <span className="sfe-row-label">{effect.label}</span>
              <span className="sfe-row-kind">{KIND_LABEL[effect.kind]}</span>
              {badge && <span className="sfe-row-badge" style={{ color: activeSeason.accentColor }}>{badge}</span>}
              <div className="sfe-row-actions">
                <button className="sfe-icon-btn" disabled={busy || i === 0} onClick={() => handleMove(effect.id, 'up')} title="Mover pra cima">
                  <ChevronUp size={13} />
                </button>
                <button className="sfe-icon-btn" disabled={busy || i === effects.length - 1} onClick={() => handleMove(effect.id, 'down')} title="Mover pra baixo">
                  <ChevronDown size={13} />
                </button>
                <button className="sfe-icon-btn" disabled={busy} onClick={() => setEditingId(effect.id)} title="Editar">
                  <Pencil size={13} />
                </button>
                <button className="sfe-icon-btn sfe-icon-btn-danger" disabled={busy} onClick={() => handleDelete(effect.id)} title="Remover">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {adding ? (
        <EffectForm
          seasonKey={seasonKey}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={handleCreate}
        />
      ) : (
        <button className="sfe-add-btn" onClick={() => setAdding(true)}>
          <Plus size={14} /> Adicionar efeito em {activeSeason.name}
        </button>
      )}

      <style>{`
        .sfe-panel {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 16px 18px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .sfe-header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; }
        .sfe-title {
          font-family: var(--font-display); font-size: 11px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--text-faint);
        }
        .sfe-hint { font-size: 11px; color: var(--text-faint); }

        .sfe-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .sfe-tab {
          display: flex; align-items: center; gap: 5px;
          padding: 6px 10px; border-radius: var(--radius);
          border: 1px solid var(--border); background: var(--bg-field);
          color: var(--text-muted); font-size: 11.5px; cursor: pointer;
        }
        .sfe-tab-active { background: var(--bg-card); }

        .sfe-error { color: var(--crimson-bright); font-size: 12px; }
        .sfe-empty { color: var(--text-faint); font-size: 12px; }

        .sfe-list { display: flex; flex-direction: column; gap: 6px; }
        .sfe-row {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px; background: var(--bg-field); border: 1px solid var(--border);
          border-radius: var(--radius); font-size: 12.5px;
        }
        .sfe-row-label { color: var(--text); flex: 1; min-width: 0; }
        .sfe-row-kind {
          font-size: 10px; color: var(--text-faint); text-transform: uppercase;
          letter-spacing: 0.5px; font-family: var(--font-display);
        }
        .sfe-row-badge { font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
        .sfe-row-actions { display: flex; gap: 2px; flex-shrink: 0; }
        .sfe-icon-btn {
          color: var(--text-faint); background: none; padding: 4px; border-radius: 4px;
        }
        .sfe-icon-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-card); }
        .sfe-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .sfe-icon-btn-danger:hover:not(:disabled) { color: var(--crimson-bright); }

        .sfe-add-btn {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 8px; border-radius: var(--radius); border: 1px dashed var(--border);
          background: none; color: var(--text-faint); font-size: 12px; cursor: pointer;
        }
        .sfe-add-btn:hover { color: var(--text); border-color: var(--border-bright); }

        .sfe-form {
          display: flex; flex-direction: column; gap: 8px;
          padding: 10px; background: var(--bg-field); border: 1px solid var(--border-field);
          border-radius: var(--radius);
        }
        .sfe-form-row { display: flex; gap: 8px; }
        .sfe-input, .sfe-select {
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 7px 10px; color: var(--text);
          font-size: 12.5px; flex: 1; min-width: 0;
        }
        .sfe-input-narrow { flex: 0 0 160px; }
        .sfe-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .sfe-btn-primary, .sfe-btn-ghost {
          padding: 6px 12px; border-radius: var(--radius); font-size: 12px; cursor: pointer;
          font-family: var(--font-display);
        }
        .sfe-btn-primary { background: linear-gradient(135deg, var(--gold-dim), #5f4d24); border: 1px solid var(--gold-dim); color: var(--gold-bright); }
        .sfe-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .sfe-btn-ghost { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-muted); }
        .sfe-spin { animation: sfe-spin 0.8s linear infinite; }
        @keyframes sfe-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
