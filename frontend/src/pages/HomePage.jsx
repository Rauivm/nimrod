import { Link } from 'react-router-dom';
import { PageHeader, Button, StatePanel } from '../components/ui.jsx';
import { CreateMissionModal } from '../components/CreateMissionModal.jsx';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../lib/api.js';
import { useWs } from '../contexts/WsContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PostCard, PostComposer } from '../components/PostCard.jsx';
import { MissionPoster } from '../components/MissionPoster.jsx';
import { OnlinePlayersPanel } from '../components/OnlinePlayersPanel.jsx';
import { CalendarWidget } from '../components/CalendarWidget.jsx';
import { ChevronDown, ChevronUp, Plus, Layers } from 'lucide-react';

const POSTS_PAGE_SIZE = 20;
const MISSIONS_PAGE_SIZE = 12;

// ── Board theme: persisted to localStorage ────────────────────────────────────
function useBoardTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('boardTheme') || 'wood'; } catch { return 'wood'; }
  });
  const toggle = () => setTheme(t => {
    const next = t === 'wood' ? 'neutral' : 'wood';
    try { localStorage.setItem('boardTheme', next); } catch {}
    return next;
  });
  return [theme, toggle];
}

export default function HomePage() {
  const { user } = useAuth();
  const { on } = useWs();
  const [posts, setPosts] = useState([]);
  const postsRef = useRef([]);
  const [missions, setMissions] = useState([]);
  const [postsError, setPostsError] = useState('');
  const [missionsError, setMissionsError] = useState('');
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [missionsExpanded, setMissionsExpanded] = useState(false);
  const [showCreateMission, setShowCreateMission] = useState(false);
  const [boardTheme, toggleBoardTheme] = useBoardTheme();

  useEffect(() => { postsRef.current = posts; }, [posts]);

  const loadPosts = useCallback(async ({ append = false } = {}) => {
    append ? setLoadingMorePosts(true) : setLoadingPosts(true);
    const before = append ? postsRef.current.at(-1)?.createdAt : null;
    const url = `/posts?limit=${POSTS_PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    let data;
    try { data = await api.get(url); setPostsError(''); }
    catch (error) { setPostsError(error.message); setLoadingPosts(false); setLoadingMorePosts(false); return; }
    setHasMorePosts(data.length === POSTS_PAGE_SIZE);
    setPosts(prev => append ? [...prev, ...data.filter(p => !prev.some(existing => existing.id === p.id))] : data);
    append ? setLoadingMorePosts(false) : setLoadingPosts(false);
  }, []);

  const loadMissions = useCallback(async () => {
    try { const data = await api.get(`/missions?status=OPEN,CLOSED,RUNNING,PAUSED&limit=${MISSIONS_PAGE_SIZE}`); setMissions(data); setMissionsError(''); }
    catch (error) { setMissionsError(error.message); }
  }, []);

  useEffect(() => { loadPosts(); loadMissions(); }, [loadPosts, loadMissions]);

  useEffect(() => {
    const upsertOpenMission = (mission) => {
      if (!mission?.id) return;
      const visible = ['OPEN', 'CLOSED', 'RUNNING', 'PAUSED'].includes(mission.status);
      setMissions(prev => {
        const idx = prev.findIndex(m => m.id === mission.id);
        if (idx === -1) return visible ? [mission, ...prev] : prev;
        if (!visible) return prev.filter(m => m.id !== mission.id);
        const next = [...prev]; next[idx] = mission; return next;
      });
    };
    const u1 = on('POST_CREATED', (post) => {
      if (!post?.parentId) setPosts(prev => prev.some(p => p.id === post.id) ? prev : [post, ...prev]);
    });
    const u2 = on('POST_LIKED', ({ postId, likeCount, liked }) => {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likeCount, likedByMe: liked } : p));
    });
    const u3 = on('POST_DELETED', ({ postId }) => {
      setPosts(prev => prev.filter(p => p.id !== postId));
    });
    const u7 = on('REPLY_CREATED',   () => {});
    const hydrate=async ({id})=>{try{upsertOpenMission(await api.get(`/missions/${id}`));}catch{/* Keep current board and retry on next update. */}};
    const u4 = on('MISSION_CREATED', hydrate);
    const u5 = on('MISSION_UPDATED', hydrate);
    const u6 = on('MISSION_DELETED', ({ missionId }) => {
      setMissions(prev => prev.filter(m => m.id !== missionId));
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7?.(); };
  }, [on]);

  const handleMissionCreated = useCallback((mission) => {
    if (!mission?.id) return;
    setMissions(prev => {
      const next = prev.filter(m => m.id !== mission.id);
      return ['OPEN','CLOSED','RUNNING','PAUSED'].includes(mission.status) ? [mission, ...next] : next;
    });
  }, []);

  const handlePostCreated = useCallback((post, replaceId, remove = false) => {
    if (remove && replaceId) {
      setPosts(prev => prev.filter(p => p.id !== replaceId));
      return;
    }
    if (!post?.id) return;
    setPosts(prev => {
      const withoutPrior = prev.filter(p => p.id !== post.id && p.id !== replaceId);
      return [post, ...withoutPrior];
    });
  }, []);

  const visibleMissions = useMemo(
    () => missionsExpanded ? missions : missions.slice(0, 2),
    [missions, missionsExpanded],
  );
  const isWood = boardTheme === 'wood';

  return (
    <div className="home-root">
      <div className="home-welcome"><PageHeader eyebrow="Seu ponto de encontro" title={`Boas-vindas, ${user?.displayName || user?.name || 'aventureiro'}`} description="Reencontre seu grupo, compartilhe histórias e descubra o que o próximo capítulo reserva." /><nav className="home-shortcuts" aria-label="Acesso rápido"><Link to="/missions">Encontrar uma missão →</Link><Link to="/profile">Meus personagens →</Link><Link to="/calendar">Calendário do mundo →</Link></nav></div>

      {/* ── Main column ─────────────────────────────────── */}
      <div className="home-main">
        {missionsError && <StatePanel kind="error" title="Não foi possível atualizar as missões" action={<Button onClick={loadMissions}>Tentar novamente</Button>}>{missionsError}</StatePanel>}

        {/* ── Quadro de Avisos ──────────────────────────── */}
        {missions.length > 0 && (
          <section className={`missions-panel ${isWood ? 'board-bronze' : 'board-graphite'}`}>

            <div className="section-header">
              <h2 className={`section-title ${isWood ? 'section-title-wood' : ''}`}>
                📋 Quadro de Avisos
              </h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* Theme toggle */}
                <button
                  onClick={toggleBoardTheme}
                  className="theme-toggle-btn"
                  title={isWood ? 'Usar acabamento grafite' : 'Usar acabamento bronze'}
                >
                  <Layers size={11} />
                  {isWood ? 'Grafite' : 'Bronze'}
                </button>
                {(
                  <button onClick={() => setShowCreateMission(true)} className="create-btn">
                    <Plus size={13} /> Nova Missão
                  </button>
                )}
              </div>
            </div>

            <div className="home-poster-grid">
              {visibleMissions.map(m => (
                <MissionPoster compact key={m.id} mission={m} onUpdate={handleMissionCreated} />
              ))}
            </div>

            <Link className="home-board-link" to="/missions">Explorar o Quadro de Avisos →</Link>
            {missions.length > 2 && (
              <button onClick={() => setMissionsExpanded(v => !v)} className={`expand-btn ${isWood ? 'expand-btn-wood' : ''}`}>
                {missionsExpanded
                  ? <><ChevronUp size={13} /> Recolher</>
                  : <><ChevronDown size={13} /> Ver todas ({missions.length})</>
                }
              </button>
            )}
          </section>
        )}

        {/* Feed */}
        <section>
          <div className="section-header">
            <h2 className="section-title">📜 Taverna</h2>
            {missions.length === 0 && (
              <button onClick={() => setShowCreateMission(true)} className="create-btn">
                <Plus size={13} /> Nova Missão
              </button>
            )}
          </div>

          <PostComposer onPost={handlePostCreated} />
          {postsError && <StatePanel kind="error" title="Não foi possível atualizar a comunidade" action={<Button onClick={() => loadPosts()}>Tentar novamente</Button>}>{postsError}</StatePanel>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            {loadingPosts ? (
              [1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '100px' }} />)
            ) : posts.length === 0 && !postsError ? (
              <div className="empty-state">
                <span>A taverna está silenciosa...</span>
                <span style={{ fontSize: '13px', color: 'var(--text-faint)' }}>Seja o primeiro a postar!</span>
              </div>
            ) : (
              posts.map(p => <PostCard key={p.id} post={p} onUpdate={loadPosts} />)
            )}
          </div>
          {!loadingPosts && hasMorePosts && (
            <button className="load-more-btn" onClick={() => loadPosts({ append: true })} disabled={loadingMorePosts}>
              {loadingMorePosts ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </section>
      </div>

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="home-sidebar">
        <OnlinePlayersPanel />
        <CalendarWidget />
      </aside>

      {showCreateMission && (
        <CreateMissionModal onClose={() => setShowCreateMission(false)} onCreated={handleMissionCreated} />
      )}

      <style>{`
        .home-root {
          display: grid;
          grid-template-columns: 1fr 260px;
          gap: 24px;
          align-items: start;
          max-width: 1020px;
          margin: 0 auto;
        }
        .home-main { display: flex; flex-direction: column; gap: 28px; min-width: 0; }
        .home-sidebar { min-width: 0; display: flex; flex-direction: column; gap: 16px;}

        /* ── Poster grid ─────────────────────────────────── */
        .home-poster-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 32px 20px;
          padding: 16px 8px 8px;
          /* Extra vertical space so rotated cards don't clip */
          overflow: visible;
        }

        /* ── Board header ────────────────────────────────── */
        .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; position: relative; z-index: 2; }
        .section-title { font-family: var(--font-display); font-size: 15px; color: var(--gold); letter-spacing: 2px; text-transform: uppercase; }
        /* Wood mode: title looks like carved/branded text */
        .section-title-wood {
          color: #e8c870;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 -1px 0 rgba(0,0,0,0.5);
        }

        /* ── Nails ───────────────────────────────────────── */
        .board-nail {
          position: absolute;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #c8a860, #6a4a10 50%, #3a2808 100%);
          box-shadow: 0 1px 3px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.15);
          z-index: 3;
        }
        .board-nail-tl { top: 12px; left: 12px; }
        .board-nail-tr { top: 12px; right: 12px; }
        .board-nail-bl { bottom: 12px; left: 12px; }
        .board-nail-br { bottom: 12px; right: 12px; }

        /* ── Theme toggle button ─────────────────────────── */
        .theme-toggle-btn {
          display: flex; align-items: center; gap: 5px;
          background: rgba(0,0,0,0.25);
          color: var(--text-muted);
          font-family: var(--font-display); font-size: 10px; font-weight: 600;
          letter-spacing: 0.8px; text-transform: uppercase;
          padding: 5px 10px; border-radius: var(--radius);
          border: 1px solid rgba(255,255,255,0.08);
          transition: all 0.15s;
        }
        .theme-toggle-btn:hover { color: var(--gold); border-color: var(--gold-dim); background: rgba(0,0,0,0.4); }

        /* ── Create button ───────────────────────────────── */
        .create-btn {
          display: flex; align-items: center; gap: 5px;
          background: var(--crimson); color: #f0d0d0;
          font-family: var(--font-display); font-size: 11px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          padding: 6px 14px; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3);
          transition: all 0.15s;
        }
        .create-btn:hover { background: var(--crimson-bright); }

        /* ── Expand button ───────────────────────────────── */
        .expand-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; color: var(--text-muted);
          font-size: 12px; padding: 8px 0; margin-top: 8px;
          border: none; transition: color 0.15s;
          letter-spacing: 0.5px; font-family: var(--font-display); text-transform: uppercase;
          position: relative; z-index: 2;
        }
        .expand-btn:hover { color: var(--gold); }
        .expand-btn-wood { color: #a08040; }
        .expand-btn-wood:hover { color: #e8c870; }

        /* ── Feed empty state ────────────────────────────── */
        .empty-state {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 48px 24px; color: var(--text-muted);
          border: 1px dashed var(--border); border-radius: var(--radius-lg);
          font-style: italic;
        }
        .load-more-btn {
          margin: 14px auto 0; display: flex; align-items: center; justify-content: center;
          background: transparent; color: var(--text-muted);
          border: 1px solid var(--border); border-radius: var(--radius);
          padding: 8px 18px; font-family: var(--font-display);
          font-size: 12px; letter-spacing: 0.8px; text-transform: uppercase;
        }
        .load-more-btn:hover:not(:disabled) { color: var(--gold); border-color: var(--gold-dim); }
        .load-more-btn:disabled { opacity: 0.5; }

        @media (max-width: 720px) {
          .home-root { grid-template-columns: 1fr; }
          .home-sidebar { display: none; }
          .section-header { align-items: stretch; flex-direction: column; gap: 10px; }
          .section-header > div { width: 100%; flex-wrap: wrap; }
          .create-btn, .theme-toggle-btn { min-height: 40px; justify-content: center; flex: 1; }
          .home-poster-grid {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 24px 14px; padding: 12px 6px 8px;
          }
        }
      `}</style>
    </div>
  );
}
