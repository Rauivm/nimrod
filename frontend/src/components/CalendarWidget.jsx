/**
 * CalendarWidget.jsx
 *
 * Versão compacta do Calendário do Mundo para a barra lateral da Home.
 * Somente leitura — controles de GM (avançar/voltar/definir sessão) ficam
 * na página completa /calendar.
 *
 * Todo dado visual (cores, imagem, ícone, efeitos de lore) vem de
 * `src/config/calendarSeasons.js`. Este componente não sabe nada sobre
 * estações específicas — ele só pede a configuração da estação que a API
 * retornou e desenha o que recebe.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useWs } from '../contexts/WsContext.jsx';
import { ChevronRight } from 'lucide-react';
import { getSeasonConfig, getSeasonImage } from '../config/calendarSeasons.js';
import { getEffectIcon, getEffectBadge } from '../config/seasonEffectDisplay.js';

export function CalendarWidget() {
  const { on } = useWs();
  const [state, setState] = useState(null);

  const load = useCallback(() => {
    api.get('/world/calendar').then(setState).catch(() => {});
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

  if (!state) return null;

  const season      = getSeasonConfig(state.season);
  const nextSeason  = getSeasonConfig(state.nextSeason);
  const sceneImage  = getSeasonImage(state.season, state.weekOfSeason);
  const SeasonIcon  = season.icon;
  const NextIcon    = nextSeason.icon;

  return (
    <Link to="/calendar" className="cw-panel">
      <div className="cw-header">
        <span className="cw-title">Calendário do Mundo</span>
      </div>

      <div className="cw-scene" style={{ background: season.cardBackground }}>
        <img
          src={sceneImage}
          alt={`${season.name} — semana ${state.weekOfSeason}`}
          className="cw-scene-img"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <SeasonIcon className="cw-scene-watermark" size={120} style={{ color: season.textColor }} />
        <div className="cw-scene-ground" style={{ background: season.groundTint }} />
        <div className="cw-scene-text">
          <div className="cw-scene-season" style={{ color: season.textColor }}>{season.name}</div>
          <div className="cw-scene-year">Ano {state.year} DC</div>
        </div>
      </div>

      <div className="cw-body">
        <div className="cw-status-row">
          <span>Semana {state.weekOfSeason} de 12</span>
          <span className="cw-dot" />
          <span>Sessão {state.currentSession}</span>
        </div>

        <div className="cw-track">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="cw-tick"
              style={i < state.weekOfSeason ? { background: season.accentColor } : undefined}
            />
          ))}
        </div>

        <div className="cw-effects">
          <span className="cw-effects-label">Efeitos da estação</span>
          <div className="cw-effects-list">
            {(state.effects || []).map((effect) => {
              const Icon = getEffectIcon(effect);
              const badge = getEffectBadge(effect);
              return (
                <div key={effect.id} className="cw-effect-row">
                  <Icon size={12} style={{ color: season.accentColor, flexShrink: 0 }} />
                  <span>{effect.label}</span>
                  {badge && <span className="cw-effect-badge" style={{ color: season.accentColor }}>{badge}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="cw-next" style={{ borderColor: nextSeason.accentColor + '55' }}>
          <div className="cw-next-label">
            <span>Próxima estação</span>
            <ChevronRight size={12} />
          </div>
          <div className="cw-next-row">
            <NextIcon size={18} style={{ color: nextSeason.accentColor }} />
            <div>
              <div className="cw-next-season" style={{ color: nextSeason.textColor }}>{nextSeason.name}</div>
              <div className="cw-next-eta">
                {state.sessionsUntilNextSeason === 0
                  ? 'Na próxima sessão'
                  : `Em ${state.sessionsUntilNextSeason} sessõe${state.sessionsUntilNextSeason === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .cw-panel {
          display: block;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          overflow: hidden;
          color: var(--text);
          transition: border-color 0.15s;
        }
        .cw-panel:hover { border-color: var(--border-bright); }

        .cw-header {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .cw-title {
          font-family: var(--font-display);
          font-size: 11px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: var(--gold);
        }

        .cw-scene {
          position: relative; height: 140px; overflow: hidden;
          display: flex; align-items: flex-end;
        }
        .cw-scene-img {
          position: absolute; inset: 0;
          width: 100%; height: 100%; object-fit: cover;
          opacity: 0.9;
        }
        .cw-scene-watermark {
          position: absolute; right: -18px; bottom: -22px;
          opacity: 0.14; pointer-events: none;
        }
        .cw-scene-ground {
          position: absolute; left: 0; right: 0; bottom: 0; height: 55%;
        }
        .cw-scene-text {
          position: relative; z-index: 1; padding: 12px 14px;
        }
        .cw-scene-season {
          font-family: var(--font-display); font-size: 20px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase;
          text-shadow: 0 2px 10px rgba(0,0,0,0.6);
        }
        .cw-scene-year {
          font-size: 12px; color: rgba(232,223,200,0.75); margin-top: 2px;
          text-shadow: 0 1px 4px rgba(0,0,0,0.6);
        }

        .cw-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; }

        .cw-status-row {
          display: flex; align-items: center; gap: 8px;
          font-size: 11.5px; color: var(--text-muted);
        }
        .cw-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-faint); }

        .cw-track { display: flex; gap: 2px; }
        .cw-tick {
          flex: 1; height: 5px; border-radius: 2px;
          background: var(--bg-field);
        }

        .cw-effects-label {
          font-family: var(--font-display); font-size: 10px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--text-faint);
        }
        .cw-effects-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
        .cw-effect-row {
          display: flex; align-items: center; gap: 7px;
          font-size: 11.5px; color: var(--text-muted); line-height: 1.3;
        }
        .cw-effect-badge {
          margin-left: auto; font-family: var(--font-mono); font-size: 10.5px;
          font-weight: 700; flex-shrink: 0;
        }

        .cw-next {
          border: 1px solid var(--border); border-radius: var(--radius);
          padding: 9px 10px; background: var(--bg-elevated);
        }
        .cw-next-label {
          display: flex; align-items: center; justify-content: space-between;
          font-family: var(--font-display); font-size: 9.5px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px;
        }
        .cw-next-row { display: flex; align-items: center; gap: 8px; }
        .cw-next-season {
          font-family: var(--font-display); font-size: 13px; font-weight: 700;
          letter-spacing: 0.5px; text-transform: uppercase;
        }
        .cw-next-eta { font-size: 11px; color: var(--text-faint); margin-top: 1px; }
      `}</style>
    </Link>
  );
}
