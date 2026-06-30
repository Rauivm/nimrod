import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../lib/api.js';
import { useWs } from '../contexts/WsContext.jsx';
import { MissionPoster } from '../components/MissionPoster.jsx';
import { ChevronDown, ChevronUp } from 'lucide-react';

const FILTERS = [
  { label: 'Missões',    value: 'MISSION', field: 'kind'   },
  { label: 'Avisos',     value: 'NOTICE',  field: 'kind'   },
  { label: 'Abertas',    value: 'OPEN',    field: 'status' },
  { label: 'Em andamento', value: 'RUNNING', field: 'status' },
  { label: 'Fechadas',   value: 'CLOSED',  field: 'status' },
  { label: 'Concluídas', value: 'FINISHED',field: 'status' },
  { label: 'Todas',      value: '',        field: ''       },
];

const INITIAL_VISIBLE = 6;
const MISSIONS_PAGE_SIZE = 30;

export default function MissionsPage() {
  const { on } = useWs();
  const [missions, setMissions] = useState([]);
  const missionsRef = useRef([]);
  const [filter, setFilter]     = useState(FILTERS[0]);
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { missionsRef.current = missions; }, [missions]);

  const load = useCallback(async ({ append = false } = {}) => {
    append ? setLoadingMore(true) : setLoading(true);
    let url = '/missions';
    const params = [];
    params.push(`limit=${MISSIONS_PAGE_SIZE}`);
    if (filter.field === 'status') params.push(`status=${filter.value}`);
    if (filter.field === 'kind')   params.push(`kind=${filter.value}`);
    if (append && missionsRef.current.length) params.push(`before=${encodeURIComponent(missionsRef.current.at(-1).created_at)}`);
    if (params.length) url += '?' + params.join('&');
    const data = await api.get(url).catch(() => []);
    setHasMore(data.length === MISSIONS_PAGE_SIZE);
    setMissions(prev => append ? [...prev, ...data.filter(m => !prev.some(existing => existing.id === m.id))] : data);
    append ? setLoadingMore(false) : setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setExpanded(false); }, [filter]);

  useEffect(() => {
    const matchesFilter = (mission) => {
      if (!mission?.id) return false;
      if (filter.field === 'status') return mission.status === filter.value;
      if (filter.field === 'kind') return mission.kind === filter.value;
      return true;
    };
    const upsert = (mission) => {
      setMissions(prev => {
        const next = prev.filter(m => m.id !== mission?.id);
        return matchesFilter(mission) ? [mission, ...next] : next;
      });
    };
    const u1 = on('MISSION_CREATED', upsert);
    const u2 = on('MISSION_UPDATED', upsert);
    const u3 = on('MISSION_DELETED', ({ missionId }) => {
      setMissions(prev => prev.filter(m => m.id !== missionId));
    });
    return () => { u1(); u2(); u3(); };
  }, [on, filter]);

  const handleMissionUpdate = useCallback((mission) => {
    if (!mission?.id) return load();
    const matches = filter.field === 'status'
      ? mission.status === filter.value
      : filter.field === 'kind'
        ? mission.kind === filter.value
        : true;
    setMissions(prev => {
      const next = prev.filter(m => m.id !== mission.id);
      return matches ? [mission, ...next] : next;
    });
  }, [filter, load]);

  const visible = useMemo(
    () => expanded ? missions : missions.slice(0, INITIAL_VISIBLE),
    [expanded, missions],
  );
  const hasHidden = missions.length > INITIAL_VISIBLE;

  return (
    <div className="missions-page">
      <div className="page-header">
        <h1 className="page-title">📋 Quadro de Avisos</h1>
      </div>

      <div className="filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.value + f.field}
            onClick={() => setFilter(f)}
            className={`filter-btn ${filter.value === f.value && filter.field === f.field ? 'active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="poster-grid">
          {[1,2,3].map(i => <div key={i} className="skeleton poster-skeleton" />)}
        </div>
      ) : missions.length === 0 ? (
        <div className="empty-state">Nenhum item encontrado</div>
      ) : (
        <>
          <div className="poster-grid">
            {visible.map(m => <MissionPoster key={m.id} mission={m} onUpdate={handleMissionUpdate} />)}
          </div>
          {hasHidden && (
            <div className="expand-row">
              <button onClick={() => setExpanded(v => !v)} className="expand-btn">
                {expanded
                  ? <><ChevronUp size={13} /> Recolher</>
                  : <><ChevronDown size={13} /> Ver todos ({missions.length})</>}
              </button>
            </div>
          )}
          {expanded && hasMore && (
            <div className="expand-row">
              <button onClick={() => load({ append: true })} disabled={loadingMore} className="expand-btn">
                {loadingMore ? 'Carregando...' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}

      <style>{`
        .missions-page { max-width: 1100px; margin: 0 auto; }
        .page-header { margin-bottom: 20px; }
        .page-title { font-family: var(--font-display); font-size: 20px; color: var(--gold); letter-spacing: 3px; text-transform: uppercase; }
        .filter-bar { display: flex; gap: 6px; margin-bottom: 28px; flex-wrap: wrap; }
        .filter-btn { padding: 6px 16px; border-radius: var(--radius); background: var(--bg-card); color: var(--text-muted); font-size: 13px; font-family: var(--font-display); letter-spacing: 0.5px; text-transform: uppercase; border: 1px solid var(--border); transition: all 0.15s; }
        .filter-btn:hover { border-color: var(--border-bright); color: var(--text); }
        .filter-btn.active { background: rgba(201,168,76,0.1); border-color: var(--gold-dim); color: var(--gold); }
        .poster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 36px 24px; padding: 20px 16px 28px; }
        .poster-skeleton { height: 260px; border-radius: 2px; }
        .expand-row { display: flex; justify-content: center; margin-top: 8px; }
        .expand-btn { display: flex; align-items: center; gap: 5px; background: none; color: var(--text-muted); font-size: 12px; padding: 8px 16px; border: 1px solid var(--border); border-radius: var(--radius); transition: all 0.15s; letter-spacing: 0.5px; font-family: var(--font-display); text-transform: uppercase; }
        .expand-btn:hover { color: var(--gold); border-color: var(--gold-dim); }
        .empty-state { text-align: center; padding: 64px 24px; color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); font-style: italic; }
        @media (max-width: 600px) {
          .poster-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 24px 16px; padding: 16px 8px 24px; }
        }
      `}</style>
    </div>
  );
}