import { Badge, Button, useToast } from './ui.jsx';
import JoinMissionModal from './JoinMissionModal.jsx';
import { MISSION_STATUSES, registrationSummary } from '../lib/missionPresentation.js';
import '../styles/mission-board.css';
import MissionActions from './MissionActions.jsx';
import { memo, useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Users, Calendar, Coins, ChevronDown, ChevronUp, PlayCircle, Clock3, ScrollText, ShieldCheck, Hourglass, Crown, PauseCircle, CheckCircle2, XCircle, Megaphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useFoundryLaunch } from '../hooks/useFoundryLaunch.js';

// ── Sub-components ─────────────────────────────────────────────────────────────

function foundryAsset(src) {
  if (!src) return null;
  if (src.startsWith('/uploads/')) return src;
  try {
    return `/api/foundry/assets?path=${encodeURIComponent(src.startsWith('http') ? new URL(src).pathname : src)}`;
  } catch {
    return `/api/foundry/assets?path=${encodeURIComponent(src)}`;
  }
}

function RealParticipantAvatars({ participants = [], count, userId }) {
  const visible = participants.slice(0, 5);
  return (
    <div className="poster-avatars">
      {visible.map((p, i) => (
        <div key={`${p.userId}-${p.characterId || i}`}
          className={`poster-avatar ${p.isGM ? 'poster-avatar-gm' : ''} ${p.dead || p.retired || !p.active ? 'poster-avatar-muted' : ''} ${p.userId === userId ? 'poster-avatar-self' : ''}`}
          title={`${p.characterName || p.playerName}${p.isGM ? ' · GM' : ''}${p.dead ? ' · morto' : p.retired ? ' · aposentado' : !p.active ? ' · inativo' : ''}`}
          >
          {p.tokenImg || p.portraitImg
            ? <img src={foundryAsset(p.tokenImg || p.portraitImg)} alt={p.characterName || p.playerName} className="poster-avatar-img" />
            : <span>{(p.characterName || p.playerName || '?')[0]}</span>}
        </div>
      ))}
      {count > 5 && (
        <div className="poster-avatar poster-avatar-overflow">
          +{count - 5}
        </div>
      )}
    </div>
  );
}

function StarRating({ missionId, avgRating, canRate, onRated }) {
  const notify = useToast();
  const [hovered, setHovered] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const rate = async (stars) => {
    setSubmitting(true);
    try { await api.post(`/missions/${missionId}/rate`, { stars }); onRated?.(); }
    catch (e) { notify(e.message, 'error'); }
    setSubmitting(false);
  };
  return (
    <div className="poster-stars">
      {canRate && [1,2,3,4,5].map(s => (
        <button key={s} onClick={() => rate(s)}
          onMouseEnter={() => setHovered(s)} onMouseLeave={() => setHovered(0)}
          aria-label={`Avaliar com ${s} estrelas`} disabled={submitting} className={`star-btn ${s <= hovered ? 'star-lit' : ''}`}>★</button>
      ))}
      {avgRating > 0 && <span className="poster-avg-rating">★ {parseFloat(avgRating).toFixed(1)}</span>}
    </div>
  );
}

// ── Reaction bar ───────────────────────────────────────────────────────────────
const REACTION_EMOJIS = ['⚔️','🔥','💀','🍺','👁️','🐉'];

function ReactionBar({ missionId, reactions = [], onUpdate }) {
  const notify = useToast();
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);

  const react = async (emoji) => {
    if (loading) return;
    const previous = reactions;
    const existing = reactions.find(r => r.emoji === emoji);
    const next = existing
      ? reactions
          .map(r => r.emoji === emoji
            ? { ...r, count: r.reacted_by_me ? Number(r.count) - 1 : Number(r.count) + 1, reacted_by_me: !r.reacted_by_me }
            : r)
          .filter(r => Number(r.count) > 0)
      : [{ emoji, count: 1, reacted_by_me: true }, ...reactions];

    setLoading(true);
    setPicking(false);
    onUpdate?.(next);
    try {
      const res = await api.post(`/missions/${missionId}/react`, { emoji });
      onUpdate?.(res.reactions);
    } catch (e) {
      onUpdate?.(previous);
      notify(e.message, 'error');
    }
    setLoading(false);
  };

  return (
    <div className="reaction-bar">
      {/* Existing reactions */}
      {reactions.map(r => (
        <button
          key={r.emoji}
          className={`reaction-pill ${r.reacted_by_me ? 'reaction-mine' : ''}`}
          onClick={() => react(r.emoji)}
          title={r.reacted_by_me ? 'Remover reação' : 'Reagir'}
        >
          {r.emoji} <span className="reaction-count">{r.count}</span>
        </button>
      ))}

      {/* Add reaction */}
      <div className="reaction-picker-wrap">
        <button className="reaction-add-btn" onClick={() => setPicking(v => !v)} title="Adicionar reação">
          {picking ? '✕' : '+'}
        </button>
        {picking && (
          <div className="reaction-picker">
            {REACTION_EMOJIS.map(e => (
              <button key={e} className="reaction-option" onClick={() => react(e)}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline Poll ────────────────────────────────────────────────────────────────
function InlinePoll({ missionId, poll, onUpdate }) {
  const notify = useToast();
  const [voting, setVoting] = useState(false);
  if (!poll) return null;

  const total = parseInt(poll.total_votes) || 0;

  const vote = async (optionId) => {
    if (voting) return;
    setVoting(true);
    try {
      await api.post(`/missions/${missionId}/poll/vote`, { optionId });
      onUpdate?.();
    } catch (e) { notify(e.message, 'error'); }
    setVoting(false);
  };

  return (
    <div className="inline-poll">
      <div className="inline-poll-question">📊 {poll.question}</div>
      <div className="inline-poll-options">
        {poll.options.map(opt => {
          const pct = total > 0 ? Math.round((parseInt(opt.vote_count) / total) * 100) : 0;
          const isMyVote = poll.my_vote_option_id === opt.id;
          return (
            <button
              key={opt.id}
              className={`poll-option ${isMyVote ? 'poll-option-voted' : ''}`}
              onClick={() => vote(opt.id)}
              disabled={voting}
            >
              <div className="poll-option-bar" style={{ width: `${pct}%` }} />
              <span className="poll-option-text">{opt.text}</span>
              <span className="poll-option-pct">{pct}%</span>
            </button>
          );
        })}
      </div>
      <div className="inline-poll-total">{total} voto{total !== 1 ? 's' : ''}</div>
    </div>
  );
}

// ── Main poster ────────────────────────────────────────────────────────────────
export const MissionPoster = memo(function MissionPoster({ mission: initialMission, onUpdate, compact = false }) {
  const { user } = useAuth();
  const { launch, loading: launchingFoundry, error: launchError } = useFoundryLaunch();
  const [mission, setLocalMission] = useState(initialMission);
  const [expanded, setExpanded] = useState(false);
  const [joining, setJoining] = useState(false);
  const notify = useToast();
  useEffect(() => { if (launchError) notify(launchError, 'error'); }, [launchError, notify]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    setLocalMission(initialMission);
  }, [initialMission]);


  const isNotice   = mission.kind === 'NOTICE';
  const isCreator  = user?.id === mission.creator_id;
  const canManage  = isCreator || user?.id === mission.gm_id;
  const isOpen     = ['OPEN','CLOSED','PAUSED'].includes(mission.status) && mission.registrations_open && (!mission.registration_deadline || new Date(mission.registration_deadline) > new Date());
  const isFinished = mission.status === 'FINISHED';
  const isDimmed   = isFinished;

  const isUserReserve = mission.user_is_reserve === true;
  const isUserPlayer  = mission.user_joined === true && !isUserReserve;


  const playerCount  = parseInt(mission.player_count) || 0;
  const reserveCount = parseInt(mission.reserve_count) || 0;
  const playersFull  = playerCount >= mission.max_players;
  const reservesFull = reserveCount >= mission.max_reserves;
  const participants = mission.participants ?? [];
  const activeSession = mission.activeSession ?? null;
  const lastSession = mission.lastSession ?? null;
  const isRunning       = mission.status === 'RUNNING';

  // Banner: MISSÃO / AVISO / ENCERRADO / CONCLUÍDO
  const bannerLabel = isNotice
    ? 'AVISO'
    : mission.status === 'PAUSED' ? 'PAUSADA' : mission.status === 'CANCELLED' ? 'CANCELADA' : isRunning ? 'EM ANDAMENTO' : isFinished ? 'CONCLUÍDO' : isOpen ? 'MISSÃO' : 'INSCRIÇÕES FECHADAS';

  const availability = registrationSummary(mission);
  const StatusIcon = isNotice ? Megaphone : isRunning ? PlayCircle : isFinished ? CheckCircle2 : mission.status === 'CANCELLED' ? XCircle : mission.status === 'PAUSED' ? PauseCircle : ScrollText;

  // Actions
  const emitMission = useCallback((updated) => {
    if (updated?.id) {
      setLocalMission(updated);
      onUpdate?.(updated);
    }
    else onUpdate?.();
  }, [onUpdate]);

  const saveEdit = async () => {
    try {
      const updated = await api.patch(`/missions/${mission.id}`, editData);
      emitMission(updated);
      setEditing(false);
      notify('Aviso atualizado.');
    }
    catch (e) { notify(e.message, 'error'); }
  };

  const enterFoundry = async () => {
    const sessionId = mission.activeSession?.id || mission.lastSession?.id || null;
    await launch(sessionId ? { sessionId } : {});
  };

  const updateReactions = useCallback((reactions) => {
    onUpdate?.({ ...mission, reactions });
  }, [mission, onUpdate]);

  const levelLabel=mission.min_level!=null ? `${mission.min_level}–${mission.max_level ?? 'livre'}` : mission.level;
  const datetime = mission.datetime ? new Date(mission.datetime) : null;

  return (
    <>
      <div
        id={`mission-${mission.id}`}
        className={`poster-wrap ${isDimmed ? 'poster-dimmed' : ''} ${expanded ? 'poster-expanded-wrap' : ''} ${compact ? 'poster-compact' : ''}`}
        data-status={mission.status}
      >
      <article className="poster" aria-labelledby={`mission-title-${mission.id}`}>

        {/* Banner */}
        <div className="poster-banner">
          <span className="poster-contract-seal" aria-hidden="true"><StatusIcon size={17} /></span><span className="poster-banner-text">{bannerLabel}</span>
        </div>

        {/* Participant pins — missions only */}
        {!isNotice && participants.length > 0 && <RealParticipantAvatars participants={participants.filter(p => p.approvalStatus === 'APPROVED')} count={playerCount + reserveCount} userId={user?.id} />}
        {!isNotice && mission.user_joined && playerCount === 0 && (
          <div className="poster-pin">📌</div>
        )}

        {/* Notice icon */}
        {isNotice && (
          <div className="poster-notice-icon">📋</div>
        )}

        {/* Title */}
        <div className="poster-title-block">
          <h3 className="poster-title" id={`mission-title-${mission.id}`}>{mission.title}</h3>
          <div className="poster-creator">Criado por {mission.creator_name}</div>
          {!isNotice && <div className="poster-gm"><Crown size={13} aria-hidden="true" /><span>Narrador: <strong>{mission.gm_name || 'a definir'}</strong></span></div>}
        </div>

        {/* Divider */}
        <div className="poster-divider"><span>✦</span></div>

        {/* Meta — missions only */}
        {!isNotice && (
          <div className="poster-meta">
            {datetime && (
              <div className="poster-meta-row">
                <Calendar size={11} />
                <span>{format(datetime, "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
              </div>
            )}
            {levelLabel && (
              <div className="poster-meta-row poster-meta-level">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>Níveis {levelLabel}</span>
              </div>
            )}
            <div className="poster-meta-row">
              <Users size={11} />
              <span>
                {playerCount}/{mission.max_players} aventureiros
              </span>
              {mission.max_reserves > 0 && (
                <span className="poster-reserve-count">
                  <Hourglass size={13} aria-hidden="true" />
                  {reserveCount}/{mission.max_reserves} na espera
                </span>
              )}
            </div>
            {(activeSession || lastSession) && (
              <div className={`poster-meta-row ${activeSession ? 'poster-session-open' : ''}`}>
                {activeSession ? <PlayCircle size={11} /> : <Clock3 size={11} />}
                <span>
                  {activeSession
                    ? `Sessão em andamento${activeSession.sessionNumber ? ` #${activeSession.sessionNumber}` : ''}`
                    : `Última sessão${lastSession.sessionNumber ? ` #${lastSession.sessionNumber}` : ''}`}
                </span>
              </div>
            )}
            {mission.reward && (
              <div className="poster-meta-row poster-reward">
                <Coins size={11} /><span>{mission.reward}</span>
              </div>
            )}
          </div>
        )}

        {!expanded && !isNotice && <p className="poster-preview">{mission.description}</p>}
        <div className="poster-availability"><Badge tone={availability.tone}>{availability.label}</Badge>{!isNotice && <span className="poster-lifecycle">{MISSION_STATUSES[mission.status] || mission.status}</span>}{!isNotice && mission.approval_required && <span className="poster-approval">Inscrição sujeita à aprovação</span>}</div>
        {!expanded && !isNotice && !mission.user_joined && isOpen && !(playersFull && reservesFull) && <Button variant="primary" className="poster-join" onClick={() => setJoining(true)}>{mission.approval_required ? 'Solicitar inscrição' : playersFull ? 'Entrar na lista de espera' : 'Participar da missão'}</Button>}
        {/* Notice: show truncated description inline */}
        {isNotice && !expanded && (
          <p className="poster-notice-preview">
            {(mission.description || '').length > 90
              ? (mission.description || '').slice(0, 90) + '…'
              : mission.description}
          </p>
        )}

        {/* Poll preview on notice card (collapsed) */}
        {isNotice && !expanded && mission.poll && (
          <div className="poster-poll-hint">📊 {mission.poll.question}</div>
        )}

        {/* Reaction bar — always visible */}
        <ReactionBar missionId={mission.id} reactions={mission.reactions} onUpdate={updateReactions} />

        {/* Expand toggle */}
        <button
          className="poster-toggle"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          aria-expanded={expanded}
          aria-controls={`mission-details-${mission.id}`}
          aria-label={`${expanded ? 'Recolher' : 'Ver detalhes de'} ${mission.title}`}
        >
          <span>{expanded ? 'Recolher detalhes' : canManage ? 'Ver detalhes e gerenciar' : 'Ver detalhes'}</span>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div id={`mission-details-${mission.id}`} className="poster-detail animate-in">
            <div className="poster-divider"><span>✦</span></div>

            {mission.meeting_location && (
              <div className="poster-location">📍 {mission.meeting_location}</div>
            )}

            <p className="poster-description">{mission.description}</p>

            {!isNotice && participants.length > 0 && (
              <div className="poster-participants-panel">
                <div className="poster-panel-title">Participantes</div>
                <div className="poster-participant-list">
                  {participants.map(p => (
                    <div key={`${p.userId}-${p.characterId || p.type}`} className={`poster-participant-row ${p.isGM ? 'poster-participant-gm' : ''}`}>
                      <div className="poster-participant-token">
                        {p.tokenImg || p.portraitImg
                          ? <img src={foundryAsset(p.tokenImg || p.portraitImg)} alt={p.characterName || p.playerName} />
                          : <span>{(p.characterName || p.playerName || '?')[0]}</span>}
                      </div>
                      <div className="poster-participant-copy">
                        <span className="poster-participant-name">{p.characterName || p.playerName}</span>
                        <span className="poster-participant-sub">
                          {p.playerName}{p.isGM ? ' · GM' : ''}{p.approvalStatus==='PENDING' ? ' · aguardando aprovação' : p.type === 'RESERVE' ? ' · reserva' : ''}
                        </span>
                      </div>
                      {(p.dead || p.retired || !p.active) && (
                        <span className="poster-participant-state">
                          {p.dead ? 'Morto' : p.retired ? 'Aposentado' : 'Inativo'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inline poll */}
            {mission.poll && (
              <InlinePoll missionId={mission.id} poll={mission.poll} onUpdate={onUpdate} />
            )}

            {/* Star rating for finished missions */}
            {isFinished && (
              <StarRating
                missionId={mission.id}
                avgRating={mission.avg_rating}
                canRate={mission.user_joined}
                onRated={onUpdate}
              />
            )}

            {!isNotice && isRunning && (canManage || (isUserPlayer && mission.user_approval_status==='APPROVED')) && (
              <button onClick={enterFoundry} disabled={launchingFoundry} className="poster-btn poster-btn-primary">Entrar na aventura</button>
            )}
            {!isNotice ? <MissionActions mission={mission} onChange={emitMission} /> : canManage && (
              <button className="poster-btn poster-btn-outline" onClick={()=>{setEditing(true);setEditData({title:mission.title,description:mission.description});}}>Editar aviso</button>
            )}

            {editing && (
              <div className="poster-edit-form">
                <input aria-label="Título do aviso" value={editData.title || ''} onChange={e => setEditData(p => ({ ...p, title: e.target.value }))} placeholder="Título" />
                <textarea aria-label="Descrição do aviso" value={editData.description || ''} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))} placeholder="Descrição" rows={3} />
                {!isNotice && <>
                  <input value={editData.level || ''} onChange={e => setEditData(p => ({ ...p, level: e.target.value }))} placeholder="Nível (ex: 1-5, Iniciante)" />
                  <input value={editData.meetingLocation || ''} onChange={e => setEditData(p => ({ ...p, meetingLocation: e.target.value }))} placeholder="Local / Canal" />
                  <input value={editData.reward || ''} onChange={e => setEditData(p => ({ ...p, reward: e.target.value }))} placeholder="Recompensa" />
                </>}
                <div className="ui-actions">
                  <button onClick={saveEdit} className="poster-btn poster-btn-primary">Salvar</button>
                  <button onClick={() => setEditing(false)} className="poster-btn poster-btn-outline">Cancelar</button>
                </div>
              </div>
            )}

          </div>
        )}


      </article>


    </div>
    {joining && <JoinMissionModal mission={mission} playersFull={playersFull} onClose={() => setJoining(false)} onJoined={result => {
      if (result.mission) emitMission(result.mission); else onUpdate?.();
      notify(mission.approval_required ? 'Inscrição enviada para aprovação.' : 'Inscrição confirmada.');
    }} />}
  </>
  );
});
