import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Search, SlidersHorizontal, Sword } from 'lucide-react';
import { CreateMissionModal } from '../components/CreateMissionModal.jsx';
import MissionNotifications from '../components/MissionNotifications.jsx';
import { MissionPoster } from '../components/MissionPoster.jsx';
import { Button, PageHeader, StatePanel, LoadingCards } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { matchesMissionSearch } from '../lib/missionPresentation.js';
import { useWs } from '../contexts/WsContext.jsx';
import '../styles/mission-board.css';

const PAGE_SIZE = 30;
const STATUS_FILTERS = [
  ['', 'Todos os estados'], ['OPEN', 'Aguardando início · abertas'], ['CLOSED', 'Aguardando início · fechadas'],
  ['RUNNING', 'Em andamento'], ['PAUSED', 'Entre sessões'], ['FINISHED', 'Concluídas'], ['CANCELLED', 'Canceladas'],
];

export default function MissionsPage() {
  const { on, connected } = useWs();
  const { hash } = useLocation();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [missions, setMissions] = useState([]);
  const [kind, setKind] = useState(hash ? '' : 'MISSION');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef(null);
  const request = useRef(0);
  const busy = useRef(false);
  const matches = useCallback(m => (!kind || m.kind === kind) && (!status || m.status === status), [kind, status]);

  const load = useCallback(async ({ append = false } = {}) => {
    if (append && busy.current) return;
    const version = ++request.current;
    busy.current = true;
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (append && cursor.current) params.set('before', cursor.current);
    try {
      const data = await api.get(`/missions?${params}`);
      if (request.current !== version) return;
      cursor.current = data.at(-1)?.created_at ?? cursor.current;
      setHasMore(data.length === PAGE_SIZE);
      setMissions(prev => append ? [...prev, ...data.filter(m => !prev.some(row => row.id === m.id))] : data);
    } catch (e) {
      if (request.current === version) setError(e.message);
    } finally {
      if (request.current === version) { setLoading(false); setLoadingMore(false); busy.current = false; }
    }
  }, [kind, status]);

  const invalidate = useCallback(() => { request.current++; busy.current = false; }, []);
  useEffect(() => { cursor.current = null; load(); return invalidate; }, [load, invalidate]);
  const wasConnected = useRef(connected);
  useEffect(() => { if (connected && !wasConnected.current) load(); wasConnected.current = connected; }, [connected, load]);
  const update = useCallback(mission => {
    if (!mission?.id) { load(); return; }
    setMissions(prev => {
      const index = prev.findIndex(row => row.id === mission.id);
      if (!matches(mission)) return prev.filter(row => row.id !== mission.id);
      if (index < 0) return [mission, ...prev];
      return prev.map(row => row.id === mission.id ? mission : row);
    });
  }, [matches, load]);

  useEffect(() => {
    let disposed = false;
    const hydrate = async ({ id, missionId } = {}) => {
      const target = id || missionId;
      if (!target) return;
      try { const mission = await api.get(`/missions/${target}`); if (!disposed) update(mission); }
      catch (e) { if (!disposed) setError(e.message); }
    };
    const unsubscribe = [on('MISSION_CREATED', hydrate), on('MISSION_UPDATED', hydrate),
      on('MISSION_DELETED', ({ missionId }) => setMissions(prev => prev.filter(m => m.id !== missionId)))];
    return () => { disposed = true; unsubscribe.forEach(fn => fn()); };
  }, [on, update]);

  // Inbox links can reach older missions outside the first batch.
  const [linkedMission, setLinkedMission] = useState(null);
  useEffect(() => {
    if (!hash.startsWith('#mission-')) { setLinkedMission(null); return; }
    const id = hash.slice('#mission-'.length);
    if (!id) return;
    let disposed = false;
    api.get(`/missions/${encodeURIComponent(id)}`).then(mission => {
      if (!disposed) { setLinkedMission(mission); setSearch(''); }
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [hash]);
  useEffect(() => {
    if (!linkedMission || loading) return;
    const target = document.getElementById(`mission-${linkedMission.id}`);
    target?.scrollIntoView({ block: 'center' });
    target?.querySelector('.poster-toggle')?.focus({ preventScroll: true });
  }, [linkedMission, loading]);

  const visible = useMemo(() => missions.filter(m => matchesMissionSearch(m, search)), [missions, search]);
  const clearFilters = () => { setKind(''); setStatus(''); setSearch(''); };
  const linkedOutsideList = linkedMission && !visible.some(m => m.id === linkedMission.id);
  return <div className="missions-page">
    <PageHeader emblem eyebrow="Contratos da guilda · Sua próxima história" title="Quadro de Avisos"
      description="Descubra aventuras, reúna seu grupo e acompanhe cada capítulo da sua jornada."
      action={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} /> Nova missão / aviso</Button>} />
    <div className="board-intro"><Sword size={22} aria-hidden="true" /><p><strong>Uma nova história começa com um convite.</strong> Confira os níveis e as vagas, abra a missão e escolha como participar. O narrador e o criador administram o grupo no mesmo lugar.</p></div>
    <MissionNotifications />
    <section className="board-filters" aria-label="Pesquisa e filtros do quadro">
      <div className="ui-tabs" role="group" aria-label="Tipo de publicação">
        {[['MISSION', 'Missões'], ['NOTICE', 'Avisos'], ['', 'Tudo']].map(([value, label]) => <Button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</Button>)}
      </div>
      <div className="board-filter-fields">
        <label className="board-search"><span className="sr-only">Pesquisar nas publicações carregadas</span><Search size={18} aria-hidden="true" /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por aventura, narrador ou criador" aria-describedby="board-search-scope" /></label>
        <label className="board-status-filter"><SlidersHorizontal size={17} aria-hidden="true" /><span className="sr-only">Estado da aventura</span><select value={status} onChange={e => setStatus(e.target.value)}>{STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="board-results"><p id="board-search-scope" role="status" aria-live="polite">{loading ? 'Carregando publicações…' : `${visible.length} de ${missions.length} publicações carregadas`}{hasMore && ' · Há mais no quadro.'} A busca considera os itens carregados.</p>{(search || status || kind !== 'MISSION') && <Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button>}</div>
    </section>
    {error && <StatePanel kind="error" title="Não foi possível atualizar o quadro" action={<Button onClick={() => load()}>Tentar novamente</Button>}>{error}</StatePanel>}
    {loading ? <LoadingCards label="Carregando o quadro de avisos" /> : <>
      {linkedOutsideList && <section className="board-linked"><h2>Publicação da notificação</h2><MissionPoster mission={linkedMission} onUpdate={m => { if (m?.id) setLinkedMission(m); update(m); }} /></section>}
      {!visible.length && !error && <StatePanel title={search || status ? 'Nenhuma publicação corresponde aos filtros' : 'O próximo capítulo ainda está por vir'} action={<Button onClick={search || status ? clearFilters : () => setCreating(true)}>{search || status ? 'Limpar filtros' : 'Publicar missão ou aviso'}</Button>}>{hasMore ? 'Carregue mais publicações para ampliar sua busca.' : 'Explore outros filtros ou convide a comunidade para uma aventura.'}</StatePanel>}
      <div className="poster-grid">{visible.map(m => <MissionPoster key={m.id} mission={m} onUpdate={update} />)}</div>
      {hasMore && <div className="board-pagination"><Button disabled={loadingMore} onClick={() => load({ append: true })}>{loadingMore ? 'Carregando…' : 'Carregar mais publicações'}</Button></div>}
    </>}
    {creating && <CreateMissionModal onClose={() => setCreating(false)} onCreated={() => load()} />}
  </div>;
}
