/**
 * CalendarPage.jsx
 *
 * Módulo: Calendário do Mundo (MVP - Etapa 1)
 *
 * Mostra o estado atual do calendário (ano, estação, semana, sessão) e,
 * para GMs, controles para avançar/voltar/definir a sessão corrente.
 *
 * Todo dado visual da estação (cor, imagem, ícone, tagline, efeitos de lore)
 * vem de `src/config/calendarSeasons.js`. Este componente não conhece
 * estações específicas — apenas pede a config da estação retornada pela API
 * e desenha o que recebe. Nenhum `if (season === ...)` aqui.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useAuth, isGM } from '../contexts/AuthContext.jsx';
import { useWs } from '../contexts/WsContext.jsx';
import {
  ChevronLeft, ChevronRight, Pencil, History, X, Loader2,
} from 'lucide-react';
import { getSeasonConfig, getSeasonImage } from '../config/calendarSeasons.js';
import { getEffectIcon, getEffectBadge } from '../config/seasonEffectDisplay.js';
import { SeasonEffectsEditor } from '../components/SeasonEffectsEditor.jsx';

function SeasonProgressBar({ week, color }) {
  const pct = (week / 12) * 100;
  return (
    <div className="season-progress-track">
      <div className="season-progress-fill" style={{ width: `${pct}%`, background: color }} />
      <div className="season-progress-ticks">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={i < week ? 'tick filled' : 'tick'} style={i < week ? { background: color } : undefined} />
        ))}
      </div>
    </div>
  );
}

function SetSessionModal({ currentSession, onClose, onConfirm, busy }) {
  const [value, setValue] = useState(String(currentSession));
  const parsed = parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1;

  return (
    <div className="cal-modal-overlay" onClick={onClose}>
      <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-header">
          <span>Definir sessão manualmente</span>
          <button onClick={onClose} className="cal-modal-close"><X size={16} /></button>
        </div>
        <p className="cal-modal-hint">
          Uso administrativo — corrige a sessão corrente do mundo diretamente.
          Essa ação fica registrada na auditoria.
        </p>
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="cal-modal-input"
          autoFocus
        />
        <div className="cal-modal-actions">
          <button onClick={onClose} className="cal-btn-ghost">Cancelar</button>
          <button
            onClick={() => valid && onConfirm(parsed)}
            disabled={!valid || busy || parsed === currentSession}
            className="cal-btn-primary"
          >
            {busy ? <Loader2 size={14} className="spin" /> : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ onClose }) {
  const [history, setHistory] = useState(null);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/world/calendar/history')
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, []);

  const actionLabel = { next: 'Avançou', previous: 'Voltou', set: 'Definiu' };

  return (
    <div className="cal-modal-overlay" onClick={onClose}>
      <div className="cal-modal cal-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-header">
          <span>Histórico do calendário</span>
          <button onClick={onClose} className="cal-modal-close"><X size={16} /></button>
        </div>
        {error && <p className="cal-error">{error}</p>}
        {!history && !error && <p className="cal-modal-hint">Carregando…</p>}
        {history && history.length === 0 && <p className="cal-modal-hint">Nenhuma alteração registrada ainda.</p>}
        {history && history.length > 0 && (
          <div className="cal-history-list">
            {history.map((h) => (
              <div key={h.id} className="cal-history-row">
                <span className="cal-history-action">{actionLabel[h.action] || h.action}</span>
                <span className="cal-history-detail">
                  Sessão {h.previousSession} → {h.newSession}
                </span>
                <span className="cal-history-meta">
                  {h.changedBy.displayName} · {new Date(h.changedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const { on } = useWs();
  const gm = isGM(user);

  const [state, setState]   = useState(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);
  const [showSetModal, setShowSetModal]     = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const load = useCallback(() => {
    api.get('/world/calendar')
      .then((data) => { setState(data); setError(null); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub = on('CALENDAR_UPDATED', (data) => setState(data));
    return unsub;
  }, [on]);

  useEffect(() => {
    const unsub = on('SEASON_EFFECTS_UPDATED', () => load());
    return unsub;
  }, [on, load]);

  async function runAction(fn) {
    setBusy(true);
    setError(null);
    try {
      const data = await fn();
      setState(data);
      setShowSetModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) {
    return (
      <div className="cal-page">
        <p className="cal-error">Não foi possível carregar o calendário: {error}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="cal-page cal-loading">
        <Loader2 size={22} className="spin" />
        <span>Carregando calendário…</span>
      </div>
    );
  }

  const season      = getSeasonConfig(state.season);
  const nextSeason  = getSeasonConfig(state.nextSeason);
  const sceneImage  = getSeasonImage(state.season, state.weekOfSeason);
  const SeasonIcon  = season.icon;
  const NextIcon    = nextSeason.icon;

  return (
    <div className="cal-page">
      <div className="cal-header">
        <h1>Calendário do Mundo</h1>
        {gm && (
          <button className="cal-btn-ghost cal-history-btn" onClick={() => setShowHistoryModal(true)}>
            <History size={14} /> Histórico
          </button>
        )}
      </div>

      {error && <p className="cal-error">{error}</p>}

      <div className="cal-card" style={{ borderColor: season.accentColor + '55' }}>
        <div className="cal-hero" style={{ background: season.cardBackground }}>
          <img
            src={sceneImage}
            alt={`${season.name} — semana ${state.weekOfSeason}`}
            className="cal-hero-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="cal-hero-overlay" />
        </div>

        <div className="cal-card-top">
          <div className="cal-season-badge" style={{ background: season.cardBackground, borderColor: season.accentColor + '55', color: season.accentColor }}>
            <SeasonIcon size={28} />
          </div>
          <div className="cal-year-season">
            <div className="cal-season-name" style={{ color: season.accentColor }}>{season.name}</div>
            <div className="cal-year">Ano {state.year} DC</div>
          </div>
          <div className="cal-session-chip">
            Sessão <strong>{state.currentSession}</strong>
          </div>
        </div>

        <p className="cal-tagline">{season.tagline}</p>

        <div className="cal-progress-block">
          <div className="cal-progress-label">
            <span>Semana {state.weekOfSeason} de 12</span>
            <span className="cal-next-season">
              {state.sessionsUntilNextSeason === 0
                ? <>Última semana — próxima sessão inicia <NextIcon size={13} style={{ verticalAlign: -2 }} /> {nextSeason.name}</>
                : <>Faltam {state.sessionsUntilNextSeason} sessõe{state.sessionsUntilNextSeason === 1 ? '' : 's'} para <NextIcon size={13} style={{ verticalAlign: -2 }} /> {nextSeason.name}</>}
            </span>
          </div>
          <SeasonProgressBar week={state.weekOfSeason} color={season.accentColor} />
        </div>

        <div className="cal-effects">
          {(state.effects || []).map((effect) => {
            const Icon = getEffectIcon(effect);
            const badge = getEffectBadge(effect);
            return (
              <span key={effect.id} className="cal-effect-chip" style={{ borderColor: season.accentColor + '40', color: season.accentColor }}>
                <Icon size={12} /> {effect.label}{badge ? ` · ${badge}` : ''}
              </span>
            );
          })}
        </div>

        <div className="cal-footer-meta">
          Sessão {state.sessionInYear} de 48 no Ano {state.year}
          {state.updatedAt && (
            <> · atualizado em {new Date(state.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</>
          )}
        </div>
      </div>

      {gm && (
        <div className="cal-controls">
          <span className="cal-controls-label">Controles do GM</span>
          <div className="cal-controls-row">
            <button
              className="cal-btn-ghost"
              disabled={busy || state.currentSession <= 1}
              onClick={() => runAction(() => api.post('/world/calendar/previous'))}
              title="Voltar uma sessão"
            >
              <ChevronLeft size={15} /> Voltar sessão
            </button>
            <button
              className="cal-btn-primary"
              disabled={busy}
              onClick={() => runAction(() => api.post('/world/calendar/next'))}
              title="Avançar uma sessão"
            >
              Avançar sessão <ChevronRight size={15} />
            </button>
            <button
              className="cal-btn-ghost"
              disabled={busy}
              onClick={() => setShowSetModal(true)}
              title="Definir sessão manualmente"
            >
              <Pencil size={13} /> Definir sessão
            </button>
          </div>
        </div>
      )}

      {gm && <SeasonEffectsEditor currentSeasonKey={season.key} />}

      {showSetModal && (
        <SetSessionModal
          currentSession={state.currentSession}
          busy={busy}
          onClose={() => setShowSetModal(false)}
          onConfirm={(n) => runAction(() => api.post('/world/calendar/session', { session: n }))}
        />
      )}

      {showHistoryModal && <HistoryModal onClose={() => setShowHistoryModal(false)} />}

      <style>{`
        .cal-page { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
        .cal-header { display: flex; align-items: center; justify-content: space-between; }
        .cal-header h1 {
          font-family: var(--font-display); font-size: 20px; letter-spacing: 1.5px;
          color: var(--gold); text-transform: uppercase;
        }
        .cal-loading { align-items: center; flex-direction: row; gap: 10px; color: var(--text-muted); padding: 40px 0; justify-content: center; }
        .cal-error { color: var(--crimson-bright); font-size: 13px; }

        .cal-card {
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow: hidden;
          box-shadow: var(--shadow);
        }

        .cal-hero { position: relative; height: 160px; overflow: hidden; }
        .cal-hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.9; }
        .cal-hero-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(0,0,0,0) 40%, var(--bg-card) 100%);
        }

        .cal-card-top { display: flex; align-items: center; gap: 14px; padding: 0 22px; margin-top: -34px; position: relative; z-index: 1; }
        .cal-season-badge {
          width: 52px; height: 52px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          border: 1px solid; flex-shrink: 0;
        }
        .cal-year-season { flex: 1; min-width: 0; }
        .cal-season-name {
          font-family: var(--font-display); font-size: 19px; font-weight: 700;
          letter-spacing: 1px; text-transform: uppercase;
        }
        .cal-year { color: var(--text-muted); font-size: 13px; margin-top: 2px; }
        .cal-session-chip {
          background: var(--bg-field); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 6px 12px; font-size: 12px;
          color: var(--text-muted); white-space: nowrap;
        }
        .cal-session-chip strong { color: var(--text); font-family: var(--font-mono); }

        .cal-tagline { color: var(--text-muted); font-size: 13.5px; line-height: 1.5; margin: 14px 22px 0; }

        .cal-progress-block { margin: 18px 22px 0; }
        .cal-progress-label {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 12px; color: var(--text-muted); margin-bottom: 8px; gap: 12px; flex-wrap: wrap;
        }
        .cal-next-season { display: flex; align-items: center; gap: 4px; color: var(--text-faint); }

        .season-progress-track { position: relative; height: 8px; background: var(--bg-field); border-radius: 4px; overflow: hidden; }
        .season-progress-fill { position: absolute; inset: 0; border-radius: 4px; transition: width 0.4s ease; opacity: 0.85; }
        .season-progress-ticks { position: absolute; inset: 0; display: flex; }
        .tick { flex: 1; border-right: 1px solid rgba(0,0,0,0.35); }
        .tick:last-child { border-right: none; }

        .cal-effects { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 22px 0; }
        .cal-effect-chip {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; padding: 5px 10px; border-radius: 999px;
          border: 1px solid; background: var(--bg-field);
        }

        .cal-footer-meta { margin: 14px 22px 20px; font-size: 11px; color: var(--text-faint); }

        .cal-controls {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 16px 18px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .cal-controls-label {
          font-family: var(--font-display); font-size: 11px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--text-faint);
        }
        .cal-controls-row { display: flex; gap: 10px; flex-wrap: wrap; }

        .cal-btn-primary, .cal-btn-ghost {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: var(--radius);
          font-size: 12.5px; font-family: var(--font-display);
          letter-spacing: 0.4px; cursor: pointer; transition: all 0.15s;
        }
        .cal-btn-primary {
          background: linear-gradient(135deg, var(--gold-dim), #5f4d24);
          border: 1px solid var(--gold-dim); color: var(--gold-bright);
        }
        .cal-btn-primary:hover:not(:disabled) { filter: brightness(1.15); }
        .cal-btn-ghost {
          background: var(--bg-field); border: 1px solid var(--border); color: var(--text-muted);
        }
        .cal-btn-ghost:hover:not(:disabled) { color: var(--text); border-color: var(--border-bright); }
        .cal-btn-primary:disabled, .cal-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
        .cal-history-btn { padding: 6px 12px; }

        .spin { animation: cal-spin 0.8s linear infinite; }
        @keyframes cal-spin { to { transform: rotate(360deg); } }

        .cal-modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px;
        }
        .cal-modal {
          background: var(--bg-modal); border: 1px solid var(--border-bright);
          border-radius: var(--radius-lg); padding: 20px; width: 100%; max-width: 360px;
          box-shadow: var(--shadow-lg);
        }
        .cal-modal-lg { max-width: 460px; }
        .cal-modal-header {
          display: flex; justify-content: space-between; align-items: center;
          font-family: var(--font-display); color: var(--gold); font-size: 14px;
          letter-spacing: 0.5px; margin-bottom: 10px;
        }
        .cal-modal-close { color: var(--text-muted); background: none; }
        .cal-modal-close:hover { color: var(--text); }
        .cal-modal-hint { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5; }
        .cal-modal-input {
          width: 100%; background: var(--bg-field); border: 1px solid var(--border-field);
          border-radius: var(--radius); padding: 9px 12px; color: var(--text);
          font-family: var(--font-mono); font-size: 14px; margin-bottom: 16px;
        }
        .cal-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

        .cal-history-list { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto; }
        .cal-history-row {
          display: flex; flex-direction: column; gap: 2px;
          padding: 8px 10px; background: var(--bg-field); border-radius: var(--radius);
          border: 1px solid var(--border);
        }
        .cal-history-action { font-family: var(--font-display); font-size: 11px; color: var(--gold); letter-spacing: 0.5px; text-transform: uppercase; }
        .cal-history-detail { font-size: 13px; color: var(--text); font-family: var(--font-mono); }
        .cal-history-meta { font-size: 11px; color: var(--text-faint); }
      `}</style>
    </div>
  );
}
