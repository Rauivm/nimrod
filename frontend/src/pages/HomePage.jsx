import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../lib/api.js';
import { useWs } from '../contexts/WsContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PostCard, PostComposer } from '../components/PostCard.jsx';
import { MissionPoster } from '../components/MissionPoster.jsx';
import { OnlinePlayersPanel } from '../components/OnlinePlayersPanel.jsx';
import { CalendarWidget } from '../components/CalendarWidget.jsx';
import { ChevronDown, ChevronUp, Plus, X, Layers } from 'lucide-react';

const POSTS_PAGE_SIZE = 20;
const MISSIONS_PAGE_SIZE = 12;

const MISSION_DESCRIPTION_TEMPLATE = `Descrição: <<Resumo da missão>>

Contrata-se um grupo de aventureiros para se infiltrar nas antigas minas de Erebor.

O objetivo é recuperar a Pedra Arken e o tesouro ancestral de um povo exilado, agora guardado por um "inquilino" perigoso!

Classificação: +12.

Gatilhos:

* Claustrofobia (cavernas)
* Escuridão
* Violência contra Criaturas Mágicas

<<>>`;

const todayInputValue = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const sanitizeDateInput = (value) => (
  String(value).replace(/[^\d-]/g, '').replace(/^(\d{4})\d+/, '$1').slice(0, 10)
);

const sanitizeTimeInput = (value) => String(value).replace(/[^\d:]/g, '').slice(0, 5);

const isValidDateValue = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
};

const isValidTimeValue = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const normalizeMissionDateTime = ({ date, time }) => {
  const resolvedDate = date?.trim() || todayInputValue();
  const resolvedTime = time?.trim() || '20:00';
  if (!isValidDateValue(resolvedDate)) throw new Error('Informe uma data válida no formato AAAA-MM-DD.');
  if (!isValidTimeValue(resolvedTime)) throw new Error('Informe um horário válido no formato HH:MM.');
  return `${resolvedDate}T${resolvedTime}`;
};

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

const CreateMissionModal = memo(function CreateMissionModal({ onClose, onCreated }) {
  const [kind, setKind] = useState('MISSION');
  const [form, setForm] = useState({
    title: '', description: MISSION_DESCRIPTION_TEMPLATE,
    date: '', time: '', reward: '', level: '', maxPlayers: 4, maxReserves: 2,
  });
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { kind, ...form };
      if (kind === 'NOTICE') {
        delete body.date;
        delete body.time;
        delete body.datetime;
        delete body.reward;
        delete body.level;
        delete body.maxPlayers;
        delete body.maxReserves;
      } else {
        body.date = sanitizeDateInput(form.date);
        body.time = sanitizeTimeInput(form.time);
        body.datetime = normalizeMissionDateTime(body);
      }
      if (pollEnabled && pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2) {
        body.pollQuestion = pollQuestion.trim();
        body.pollOptions = pollOptions.filter(o => o.trim());
      }
      const created = await api.post('/missions', body);
      onCreated?.(created);
      onClose?.();
    } catch (err) { alert(err.message); }
    setLoading(false);
  }, [form, kind, onClose, onCreated, pollEnabled, pollOptions, pollQuestion]);

  const set = useCallback((k, v) => setForm(p => ({ ...p, [k]: v })), []);
  const setKindPreservingDescription = useCallback((nextKind) => {
    setKind(nextKind);
    setForm(p => {
      if (nextKind === 'MISSION' && !p.description.trim()) {
        return { ...p, description: MISSION_DESCRIPTION_TEMPLATE };
      }
      return p;
    });
  }, []);
  const setOpt = useCallback((i, v) => setPollOptions(opts => opts.map((o, idx) => idx === i ? v : o)), []);
  const addOpt = useCallback(() => setPollOptions(o => o.length < 8 ? [...o, ''] : o), []);
  const removeOpt = useCallback((i) => setPollOptions(o => o.length > 2 ? o.filter((_, idx) => idx !== i) : o), []);

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal animate-in">
        <div className="modal-header">
          <h2>Novo Aviso / Missão</h2>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {/* Kind toggle */}
        <div className="kind-toggle">
          <button
            type="button"
            className={`kind-btn ${kind === 'MISSION' ? 'kind-active' : ''}`}
            onClick={() => setKindPreservingDescription('MISSION')}
          >⚔ Missão</button>
          <button
            type="button"
            className={`kind-btn ${kind === 'NOTICE' ? 'kind-active' : ''}`}
            onClick={() => setKindPreservingDescription('NOTICE')}
          >📋 Aviso</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group">
            <label>Título *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} required placeholder={kind === 'MISSION' ? 'Nome da missão' : 'Título do aviso'} />
          </div>
          <div className="form-group">
            <label>Descrição *</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} required placeholder={kind === 'MISSION' ? 'Detalhes da aventura...' : 'Conteúdo do aviso...'} rows={4} />
          </div>

          {/* Mission-only fields */}
          {kind === 'MISSION' && (<>
            <div className="form-row">
              <div className="form-group">
                <label>Nível</label>
                <input value={form.level} onChange={e => set('level', e.target.value)} placeholder="Ex: 1–5, Iniciante" />
              </div>
              <div className="form-group">
                <label>Data</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.date}
                  onChange={e => set('date', sanitizeDateInput(e.target.value))}
                  placeholder={todayInputValue()}
                />
              </div>
              <div className="form-group">
                <label>Hora</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={form.time}
                  onChange={e => set('time', sanitizeTimeInput(e.target.value))}
                  placeholder="20:00"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Recompensa</label>
              <input value={form.reward} onChange={e => set('reward', e.target.value)} placeholder="100 XP, item mágico..." />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Máx. Jogadores</label>
                <input type="number" min="1" max="20" value={form.maxPlayers} onChange={e => set('maxPlayers', parseInt(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Máx. Reservas</label>
                <input type="number" min="0" max="10" value={form.maxReserves} onChange={e => set('maxReserves', parseInt(e.target.value))} />
              </div>
            </div>
          </>)}

          {/* Poll section — notices always show toggle, missions could too */}
          <div className="poll-toggle-row">
            <label className="poll-toggle-label">
              <input type="checkbox" checked={pollEnabled} onChange={e => setPollEnabled(e.target.checked)} style={{ width: 'auto' }} />
              Adicionar enquete
            </label>
          </div>

          {pollEnabled && (
            <div className="poll-builder">
              <div className="form-group">
                <label>Pergunta</label>
                <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Qual é a pergunta?" required={pollEnabled} />
              </div>
              <div className="form-group">
                <label>Opções (mín. 2)</label>
                {pollOptions.map((opt, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px' }}>
                    <input value={opt} onChange={e => setOpt(i, e.target.value)} placeholder={`Opção ${i + 1}`} style={{ flex: 1 }} />
                    {pollOptions.length > 2 && (
                      <button type="button" onClick={() => removeOpt(i)} style={{ background: 'none', color: 'var(--crimson-bright)', border: 'none', padding: '0 4px', fontSize: '16px' }}>×</button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 8 && (
                  <button type="button" onClick={addOpt} className="add-opt-btn">+ Adicionar opção</button>
                )}
              </div>
            </div>
          )}

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Criando...' : kind === 'MISSION' ? 'Criar Missão' : 'Publicar Aviso'}
          </button>
        </form>
      </div>

      <style>{`
        .modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.78); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; overscroll-behavior: contain; }
        .modal { background: var(--bg-modal); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); padding: 24px; width: min(100%, 580px); max-height: min(90vh, 760px); overflow-y: auto; box-shadow: var(--shadow-lg); }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .modal-header h2 { font-family: var(--font-display); font-size: 18px; color: var(--gold); letter-spacing: 1px; }

        /* Kind toggle */
        .kind-toggle { display: flex; gap: 0; margin-bottom: 16px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
        .kind-btn { flex: 1; padding: 9px; background: var(--bg-card); color: var(--text-muted); font-family: var(--font-display); font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; border: none; transition: all 0.15s; }
        .kind-btn:hover { background: var(--bg-card-hover); color: var(--text); }
        .kind-active { background: rgba(201,168,76,0.12) !important; color: var(--gold) !important; box-shadow: inset 0 0 0 1px var(--gold-dim); }

        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        /* Poll builder */
        .poll-toggle-row { display: flex; align-items: center; }
        .poll-toggle-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); cursor: pointer; }
        .poll-builder { background: var(--bg-soft); border: 1px solid var(--border-field); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .add-opt-btn { background: none; border: 1px dashed var(--border); color: var(--text-muted); font-size: 12px; padding: 4px 10px; border-radius: var(--radius); cursor: pointer; transition: all 0.15s; align-self: flex-start; margin-top: 2px; }
        .add-opt-btn:hover { border-color: var(--gold-dim); color: var(--gold); }

        .submit-btn { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 10px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); margin-top: 4px; transition: all 0.15s; }
        .submit-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        @media (max-width: 620px) {
          .modal-overlay { align-items: flex-start; padding: 10px; }
          .modal { padding: 16px; max-height: calc(100vh - 20px); }
          .modal-header h2 { font-size: 16px; }
          .form-row { grid-template-columns: 1fr; gap: 10px; }
          .kind-btn, .submit-btn { min-height: 42px; }
        }
      `}</style>
    </div>
  );
});

// ── Wood board SVG background (data URI) ─────────────────────────────────────
// Multi-layer approach: CSS only, no external image needed
const WOOD_STYLE = {
  background: `
    linear-gradient(
      180deg,
      rgba(0,0,0,0.08) 0px, transparent 1px,
      transparent 28px, rgba(0,0,0,0.05) 29px, transparent 30px,
      transparent 58px, rgba(0,0,0,0.07) 59px, transparent 60px,
      transparent 88px, rgba(0,0,0,0.04) 89px, transparent 90px,
      transparent 118px, rgba(0,0,0,0.06) 119px, transparent 120px
    ),
    linear-gradient(
      178deg,
      rgba(255,255,255,0.03) 0%, transparent 40%,
      rgba(0,0,0,0.04) 60%, transparent 100%
    ),
    linear-gradient(
      170deg,
      #2d1a0a 0%, #3d2410 15%, #2a1608 30%,
      #4a2e14 45%, #321a09 60%,
      #3e2410 75%, #2c1a08 90%, #3a2210 100%
    )
  `,
  backgroundSize: '100% 120px, 100% 100%, 100% 100%',
  borderRadius: '6px',
  border: '3px solid #1a0d04',
  boxShadow: `
    inset 0 2px 6px rgba(0,0,0,0.5),
    inset 0 -2px 6px rgba(0,0,0,0.4),
    inset 4px 0 12px rgba(0,0,0,0.3),
    inset -4px 0 12px rgba(0,0,0,0.3),
    0 8px 32px rgba(0,0,0,0.6),
    0 2px 8px rgba(0,0,0,0.4)
  `,
  outline: '1px solid #5a3010',
  outlineOffset: '-6px',
  padding: '20px 16px 24px',
  position: 'relative',
};

const NEUTRAL_STYLE = {
  background: 'rgba(201,168,76,0.03)',
  border: '1px solid rgba(201,168,76,0.1)',
  borderRadius: '8px',
  padding: '16px',
};

export default function HomePage() {
  const { user } = useAuth();
  const { on } = useWs();
  const [posts, setPosts] = useState([]);
  const postsRef = useRef([]);
  const [missions, setMissions] = useState([]);
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
    const data = await api.get(url).catch(() => []);
    setHasMorePosts(data.length === POSTS_PAGE_SIZE);
    setPosts(prev => append ? [...prev, ...data.filter(p => !prev.some(existing => existing.id === p.id))] : data);
    append ? setLoadingMorePosts(false) : setLoadingPosts(false);
  }, []);

  const loadMissions = useCallback(async () => {
    const data = await api.get(`/missions?status=OPEN,CLOSED,RUNNING&limit=${MISSIONS_PAGE_SIZE}`).catch(() => []);
    setMissions(data);
  }, []);

  useEffect(() => { loadPosts(); loadMissions(); }, [loadPosts, loadMissions]);

  useEffect(() => {
    const upsertOpenMission = (mission) => {
      if (!mission?.id) return;
      const visible = ['OPEN', 'CLOSED', 'RUNNING'].includes(mission.status);
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
    const u4 = on('MISSION_CREATED', upsertOpenMission);
    const u5 = on('MISSION_UPDATED', upsertOpenMission);
    const u6 = on('MISSION_DELETED', ({ missionId }) => {
      setMissions(prev => prev.filter(m => m.id !== missionId));
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7?.(); };
  }, [on]);

  const handleMissionCreated = useCallback((mission) => {
    if (!mission?.id || !['OPEN','CLOSED','RUNNING'].includes(mission?.status)) return;
    setMissions(prev => {
      const next = prev.filter(m => m.id !== mission.id);
      return [mission, ...next];
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
    () => missionsExpanded ? missions : missions.slice(0, 3),
    [missions, missionsExpanded],
  );
  const isWood = boardTheme === 'wood';

  return (
    <div className="home-root">

      {/* ── Main column ─────────────────────────────────── */}
      <div className="home-main">

        {/* ── Quadro de Avisos ──────────────────────────── */}
        {missions.length > 0 && (
          <section className="missions-panel" style={isWood ? WOOD_STYLE : NEUTRAL_STYLE}>

            {/* Wood nail decorations */}
            {isWood && <>
              <div className="board-nail board-nail-tl" />
              <div className="board-nail board-nail-tr" />
              <div className="board-nail board-nail-bl" />
              <div className="board-nail board-nail-br" />
            </>}

            <div className="section-header">
              <h2 className={`section-title ${isWood ? 'section-title-wood' : ''}`}>
                📋 Quadro de Avisos
              </h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* Theme toggle */}
                <button
                  onClick={toggleBoardTheme}
                  className="theme-toggle-btn"
                  title={isWood ? 'Mudar para estilo neutro' : 'Mudar para madeira'}
                >
                  <Layers size={11} />
                  {isWood ? 'Neutro' : 'Madeira'}
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
                <MissionPoster key={m.id} mission={m} onUpdate={handleMissionCreated} />
              ))}
            </div>

            {missions.length > 3 && (
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            {loadingPosts ? (
              [1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '100px' }} />)
            ) : posts.length === 0 ? (
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