import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Users, Calendar, Coins, Edit3, Trash2, X, Check, UserPlus, ChevronDown, ChevronUp, Scroll, PlayCircle, Dice5, Clock3 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, isGM, isGMPrincipal, roleLabel } from '../contexts/AuthContext.jsx';
import JoinMissionModal from './JoinMissionModal.jsx';
import { useFoundryLaunch } from '../hooks/useFoundryLaunch.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function idToRotation(id) {
  if (!id) return 0;
  const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return ((hash % 100) / 100 - 0.5) * 6.4;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ParticipantAvatars({ count, maxPlayers, userJoined }) {
  const slots = Math.min(count, 5);
  const colors = ['#8b2020','#7a4020','#2a5a3a','#2a3a7a','#5a2a7a'];
  return (
    <div className="poster-avatars">
      {Array.from({ length: slots }).map((_, i) => (
        <div key={i} className="poster-avatar"
          style={{
            background: colors[i % colors.length],
            marginLeft: i === 0 ? 0 : '-8px',
            zIndex: slots - i,
            border: userJoined && i === 0 ? '2px solid #c9a84c' : '2px solid rgba(200,169,112,0.2)',
          }}>
          {i === 0 && userJoined ? '📌' : '⚔'}
        </div>
      ))}
      {count > 5 && (
        <div className="poster-avatar poster-avatar-overflow" style={{ marginLeft: '-8px', zIndex: 0 }}>
          +{count - 5}
        </div>
      )}
    </div>
  );
}

function foundryAsset(src) {
  if (!src) return null;
  if (src.startsWith('/uploads/')) return src;
  try {
    return `/api/foundry/assets?path=${encodeURIComponent(src.startsWith('http') ? new URL(src).pathname : src)}`;
  } catch {
    return `/api/foundry/assets?path=${encodeURIComponent(src)}`;
  }
}

function inviteDisplayName(player) {
  return player?.displayName || player?.display_name || player?.name || 'Jogador';
}

function inviteCharacter(player) {
  const characters = player?.characters || player?.playerCharacters || [];
  return Array.isArray(characters) ? characters[0] : null;
}

function inviteAvatar(player, character) {
  return character?.tokenImg || character?.token_img || character?.portraitImg || character?.portrait_img || player?.avatarUrl || player?.avatar_url || null;
}

function RealParticipantAvatars({ participants = [], count, userJoined }) {
  const visible = participants.slice(0, 5);
  const colors = ['#8b2020','#7a4020','#2a5a3a','#2a3a7a','#5a2a7a'];
  return (
    <div className="poster-avatars">
      {visible.map((p, i) => (
        <div key={`${p.userId}-${p.characterId || i}`}
          className={`poster-avatar ${p.isGM ? 'poster-avatar-gm' : ''} ${p.dead || p.retired || !p.active ? 'poster-avatar-muted' : ''}`}
          title={`${p.characterName || p.playerName}${p.isGM ? ' · GM' : ''}${p.dead ? ' · morto' : p.retired ? ' · aposentado' : !p.active ? ' · inativo' : ''}`}
          style={{
            background: colors[i % colors.length],
            marginLeft: i === 0 ? 0 : '-8px',
            zIndex: visible.length - i,
            border: userJoined && i === 0 ? '2px solid #c9a84c' : '2px solid rgba(200,169,112,0.2)',
          }}>
          {p.tokenImg || p.portraitImg
            ? <img src={foundryAsset(p.tokenImg || p.portraitImg)} alt={p.characterName || p.playerName} className="poster-avatar-img" />
            : <span>{(p.characterName || p.playerName || '?')[0]}</span>}
        </div>
      ))}
      {count > 5 && (
        <div className="poster-avatar poster-avatar-overflow" style={{ marginLeft: '-8px', zIndex: 0 }}>
          +{count - 5}
        </div>
      )}
    </div>
  );
}

function StarRating({ missionId, avgRating, canRate, onRated }) {
  const [hovered, setHovered] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const rate = async (stars) => {
    setSubmitting(true);
    try { await api.post(`/missions/${missionId}/rate`, { stars }); onRated?.(); }
    catch (e) { alert(e.message); }
    setSubmitting(false);
  };
  return (
    <div className="poster-stars">
      {canRate && [1,2,3,4,5].map(s => (
        <button key={s} onClick={() => rate(s)}
          onMouseEnter={() => setHovered(s)} onMouseLeave={() => setHovered(0)}
          disabled={submitting} className={`star-btn ${s <= hovered ? 'star-lit' : ''}`}>★</button>
      ))}
      {avgRating > 0 && <span className="poster-avg-rating">★ {parseFloat(avgRating).toFixed(1)}</span>}
    </div>
  );
}

// ── Reaction bar ───────────────────────────────────────────────────────────────
const REACTION_EMOJIS = ['⚔️','🔥','💀','🍺','👁️','🐉'];

function ReactionBar({ missionId, reactions = [], onUpdate }) {
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
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="reaction-bar" onClick={e => e.stopPropagation()}>
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
  const [voting, setVoting] = useState(false);
  if (!poll) return null;

  const total = parseInt(poll.total_votes) || 0;

  const vote = async (optionId) => {
    if (voting) return;
    setVoting(true);
    try {
      await api.post(`/missions/${missionId}/poll/vote`, { optionId });
      onUpdate?.();
    } catch (e) { alert(e.message); }
    setVoting(false);
  };

  return (
    <div className="inline-poll" onClick={e => e.stopPropagation()}>
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
export const MissionPoster = memo(function MissionPoster({ mission: initialMission, onUpdate }) {
  const { user } = useAuth();
  const { launch, loading: launchingFoundry } = useFoundryLaunch();
  const [mission, setLocalMission] = useState(initialMission);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUsers, setInviteUsers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [showJoinModal, setShowJoinModal] = useState(false);

  useEffect(() => {
    setLocalMission(initialMission);
  }, [initialMission]);

  const rotation = useMemo(() => idToRotation(mission.id), [mission.id]);

  const isNotice   = mission.kind === 'NOTICE';
  const isCreator  = user?.id === mission.creator_id;
  const currentUserIsGM       = isGM(user);
  const canManage  = isCreator || currentUserIsGM;
  const isOpen     = mission.status === 'OPEN';
  const isFinished = mission.status === 'FINISHED';
  const isClosed   = mission.status === 'CLOSED';
  const isDimmed   = isFinished || isClosed;

  const playerCount  = parseInt(mission.player_count) || 0;
  const reserveCount = parseInt(mission.reserve_count) || 0;
  const playersFull  = playerCount >= mission.max_players;
  const reservesFull = reserveCount >= mission.max_reserves;
  const participants = mission.participants ?? [];
  const activeSession = mission.activeSession ?? null;
  const lastSession = mission.lastSession ?? null;
  const canOpenSession = !isNotice && canManage;
  const canEnterFoundry = !isNotice && activeSession && (isCreator || (isOpen && mission.user_joined));

  // Banner: MISSÃO / AVISO / ENCERRADO / CONCLUÍDO
  const bannerLabel = isNotice
    ? 'AVISO'
    : isOpen ? 'MISSÃO' : isClosed ? 'ENCERRADO' : 'CONCLUÍDO';

  const bannerColor = isNotice
    ? 'linear-gradient(90deg, #4a3800 0%, #2e2200 50%, #4a3800 100%)'
    : 'linear-gradient(90deg, #7a1818 0%, #5a0e0e 50%, #7a1818 100%)';

  // Actions
  const emitMission = useCallback((updated) => {
    if (updated?.id) {
      setLocalMission(updated);
      onUpdate?.(updated);
    }
    else onUpdate?.();
  }, [onUpdate]);

  // Opens the character-picker modal instead of joining directly
  const join = () => {
    setShowJoinModal(true);
  };

  const handleJoined = (res) => {
    emitMission(res.mission);
  };
  const leave = async () => {
    const previous = mission;
    setLocalMission(m => ({
      ...m,
      user_joined: false,
      player_count: String(Math.max((parseInt(m.player_count) || 0) - 1, 0)),
    }));
    setLoading(true);
    try {
      const res = await api.delete(`/missions/${mission.id}/join`);
      emitMission(res.mission);
    }
    catch (e) { setLocalMission(previous); alert(e.message); }
    setLoading(false);
  };
  const setStatus = async (status) => {
    setLoading(true);
    try {
      const updated = await api.patch(`/missions/${mission.id}`, { status });
      emitMission(updated);
    }
    catch (e) { alert(e.message); }
    setLoading(false);
  };
  const deleteMission = async () => {
    if (!confirm('Apagar esta missão?')) return;
    try { await api.delete(`/missions/${mission.id}`); onUpdate?.(); }
    catch (e) { alert(e.message); }
  };
  const loadInviteUsers = async () => {
    const us = await api.get('/users');
    setInviteUsers(us);
    setShowInvite(true);
  };
  const invite = async (userId) => {
    try {
      const updated = await api.post(`/missions/${mission.id}/invite`, { userId });
      emitMission(updated);
      setShowInvite(false);
    }
    catch (e) { alert(e.message); }
  };
  const saveEdit = async () => {
    try {
      const updated = await api.patch(`/missions/${mission.id}`, editData);
      emitMission(updated);
      setEditing(false);
    }
    catch (e) { alert(e.message); }
  };

  const openMissionSession = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/missions/${mission.id}/session`, {});
      if (res.mission) emitMission(res.mission);
      if (res.session?.id) await launch({ sessionId: res.session.id });
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const enterFoundry = async () => {
    const sessionId = mission.activeSession?.id || mission.lastSession?.id || null;
    await launch(sessionId ? { sessionId } : {});
  };

  const updateReactions = useCallback((reactions) => {
    onUpdate?.({ ...mission, reactions });
  }, [mission, onUpdate]);

  const datetime = mission.datetime ? new Date(mission.datetime) : null;

  return (
    <>
      <div
        className={`poster-wrap ${isDimmed ? 'poster-dimmed' : ''} ${expanded ? 'poster-expanded-wrap' : ''}`}
        style={{ '--rot': `${rotation}deg` }}
      >
      <div className="poster" onClick={() => !expanded && setExpanded(true)}>

        {/* Banner */}
        <div className="poster-banner" style={{ background: bannerColor }}>
          <span className="poster-banner-text">{bannerLabel}</span>
        </div>

        {/* Participant pins — missions only */}
        {!isNotice && playerCount > 0 && (
          participants.length
            ? <RealParticipantAvatars participants={participants} count={participants.length || playerCount} userJoined={mission.user_joined} />
            : <ParticipantAvatars count={playerCount} maxPlayers={mission.max_players} userJoined={mission.user_joined} />
        )}
        {!isNotice && mission.user_joined && playerCount === 0 && (
          <div className="poster-pin">📌</div>
        )}

        {/* Notice icon */}
        {isNotice && (
          <div className="poster-notice-icon">📋</div>
        )}

        {/* Title */}
        <div className="poster-title-block">
          <h3 className="poster-title">{mission.title}</h3>
          <div className="poster-creator">— {mission.creator_name} —</div>
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
            {mission.level && (
              <div className="poster-meta-row poster-meta-level">
                {/* ⚗ alchemical flask as level icon */}
                <span className="level-icon">⚗</span>
                <span>{mission.level}</span>
              </div>
            )}
            <div className="poster-meta-row">
              <Users size={11} />
              <span style={{ color: playersFull ? '#8b2020' : '#2a6a3a' }}>
                {playerCount}/{mission.max_players} aventureiros
              </span>
              {mission.max_reserves > 0 && (
                <span style={{ fontSize: '10px', color: '#6a5a3a' }}>
                  +{reserveCount}/{mission.max_reserves} reserva
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

        {/* Notice: show truncated description inline */}
        {isNotice && !expanded && (
          <p className="poster-notice-preview">
            {mission.description.length > 90
              ? mission.description.slice(0, 90) + '…'
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
          title={expanded ? 'Recolher' : 'Ver detalhes'}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="poster-detail animate-in" onClick={e => e.stopPropagation()}>
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
                          {p.playerName}{p.isGM ? ' · GM' : ''}{p.type === 'RESERVE' ? ' · reserva' : ''}
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

            <div className="poster-actions">
              {canEnterFoundry && (
                <button onClick={enterFoundry} disabled={launchingFoundry} className="poster-btn poster-btn-primary">
                  <Dice5 size={11} /> Entrar na aventura
                </button>
              )}

              {canOpenSession && (
                <button onClick={openMissionSession} disabled={loading} className="poster-btn poster-btn-outline">
                  <Scroll size={11} /> {activeSession ? 'Abrir Sessão' : 'Abrir Sessão'}
                </button>
              )}

              {/* Player join */}
              {!isNotice && isOpen && (
                mission.user_joined ? (
                  <button onClick={leave} disabled={loading} className="poster-btn poster-btn-outline">Sair</button>
                ) : playersFull && reservesFull ? (
                  <span className="poster-queue-full">Fila Cheia</span>
                ) : (
                  <button onClick={join} disabled={loading} className="poster-btn poster-btn-primary">
                    {playersFull ? 'Entrar na Reserva' : 'Participar'}
                  </button>
                )
              )}

              {/* GM/creator actions */}
              {canManage && (
                <>
                  {isOpen && (
                    <>
                      {!isNotice && (
                        <button onClick={() => setStatus('CLOSED')} disabled={loading} className="poster-btn poster-btn-outline">
                          <X size={11} /> Fechar
                        </button>
                      )}
                      <button onClick={() => {
                        setEditing(true);
                        setEditData({ title: mission.title, description: mission.description, meetingLocation: mission.meeting_location, level: mission.level, reward: mission.reward });
                      }} className="poster-btn poster-btn-outline">
                        <Edit3 size={11} /> Editar
                      </button>
                      {!isNotice && (
                        <button onClick={loadInviteUsers} className="poster-btn poster-btn-outline">
                          <UserPlus size={11} /> Convidar
                        </button>
                      )}
                    </>
                  )}
                  {isClosed && !isNotice && (
                    <button onClick={() => setStatus('FINISHED')} disabled={loading} className="poster-btn poster-btn-primary">
                      <Check size={11} /> Concluir
                    </button>
                  )}
                  <button onClick={deleteMission} className="poster-btn poster-btn-danger">
                    <Trash2 size={11} /> Apagar
                  </button>
                </>
              )}
            </div>

            {editing && (
              <div className="poster-edit-form">
                <input value={editData.title || ''} onChange={e => setEditData(p => ({ ...p, title: e.target.value }))} placeholder="Título" />
                <textarea value={editData.description || ''} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))} placeholder="Descrição" rows={3} />
                {!isNotice && <>
                  <input value={editData.level || ''} onChange={e => setEditData(p => ({ ...p, level: e.target.value }))} placeholder="Nível (ex: 1-5, Iniciante)" />
                  <input value={editData.meetingLocation || ''} onChange={e => setEditData(p => ({ ...p, meetingLocation: e.target.value }))} placeholder="Local / Canal" />
                  <input value={editData.reward || ''} onChange={e => setEditData(p => ({ ...p, reward: e.target.value }))} placeholder="Recompensa" />
                </>}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={saveEdit} className="poster-btn poster-btn-primary">Salvar</button>
                  <button onClick={() => setEditing(false)} className="poster-btn poster-btn-outline">Cancelar</button>
                </div>
              </div>
            )}

            {showInvite && (
              <div className="poster-invite-list">
                <div className="poster-invite-label">Convidar jogador:</div>
                {inviteUsers.filter(u => u.id !== user?.id).map(u => {
                  const character = inviteCharacter(u);
                  const avatar = inviteAvatar(u, character);
                  const displayName = inviteDisplayName(u);
                  const alreadyParticipant = participants.some(p => p.userId === u.id);

                  return (
                    <div key={u.id} className="poster-invite-row">
                      <div className="poster-invite-player">
                        <div className="poster-invite-avatar">
                          {avatar
                            ? <img src={foundryAsset(avatar)} alt={displayName} />
                            : <span>{displayName[0]}</span>}
                        </div>
                        <div className="poster-invite-copy">
                          <span className="poster-invite-name">{displayName}</span>
                          <span className="poster-invite-character">
                            {character ? character.name : 'Sem personagem vinculado'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => invite(u.id)}
                        className="poster-btn poster-btn-primary"
                        disabled={alreadyParticipant}
                      >
                        {alreadyParticipant ? 'Já participa' : 'Convidar'}
                      </button>
                    </div>
                  );
                })}
                <button onClick={() => setShowInvite(false)} className="poster-btn poster-btn-outline" style={{ marginTop: '4px' }}>Fechar</button>
              </div>
            )}
          </div>
        )}

        {/* Corner aging */}
        <div className="poster-corner poster-corner-tl" />
        <div className="poster-corner poster-corner-tr" />
        <div className="poster-corner poster-corner-bl" />
        <div className="poster-corner poster-corner-br" />
      </div>

      <style>{`
        /* ── Wrapper ─────────────────────────────────────────── */
        .poster-wrap {
          transform: rotate(var(--rot));
          transition: transform 0.25s cubic-bezier(.22,.68,0,1.4), filter 0.2s;
          transform-origin: center bottom;
          cursor: pointer;
          position: relative;
        }
        .poster-wrap:hover { transform: rotate(0deg) scale(1.03); z-index: 10; }
        .poster-expanded-wrap { transform: rotate(0deg) !important; z-index: 10; cursor: default; }
        .poster-dimmed { filter: grayscale(0.75) brightness(0.7); }

        /* ── Parchment ───────────────────────────────────────── */
        .poster {
          position: relative;
          background:
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E"),
            linear-gradient(170deg, #f9eecb 0%, #f2dfa0 25%, #e8ca78 60%, #d9b356 100%);
          border-radius: 1px;
          padding: 18px 16px 14px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.35), inset 0 0 40px rgba(120,70,10,0.12);
          outline: 2px solid #7a5c18;
          outline-offset: -5px;
          overflow: hidden;
          font-family: var(--font-display);
          color: #2a1a06;
          min-width: 0;
        }
        .poster::before {
          content: '';
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 45%, rgba(70,35,5,0.4) 100%);
          pointer-events: none; z-index: 1;
        }

        /* ── Banner ──────────────────────────────────────────── */
        .poster-banner {
          text-align: center;
          margin: -18px -16px 14px;
          padding: 7px 16px;
          border-bottom: 2px solid rgba(0,0,0,0.4);
          position: relative; z-index: 2;
        }
        .poster-banner-text {
          font-family: var(--font-display);
          font-size: 12px; font-weight: 900;
          letter-spacing: 6px;
          color: #f0c890;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        /* ── Avatars / notice icon ───────────────────────────── */
        .poster-avatars {
          display: flex; justify-content: center;
          margin-bottom: 10px; position: relative; z-index: 2;
        }
        .poster-avatar {
          width: 26px; height: 26px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; position: relative;
          box-shadow: 0 1px 5px rgba(0,0,0,0.45);
          overflow: hidden;
        }
        .poster-avatar-img { width: 100%; height: 100%; object-fit: cover; }
        .poster-avatar-gm { box-shadow: 0 0 0 1px #c9a84c, 0 1px 5px rgba(0,0,0,0.45); }
        .poster-avatar-muted { filter: grayscale(0.9); opacity: 0.58; }
        .poster-avatar-overflow { background: #3a2508; color: #e8c860; font-size: 9px; font-weight: 700; }
        .poster-pin { text-align: center; font-size: 18px; margin-bottom: 8px; position: relative; z-index: 2; }
        .poster-notice-icon { text-align: center; font-size: 22px; margin-bottom: 8px; position: relative; z-index: 2; }

        /* ── Title ───────────────────────────────────────────── */
        .poster-title-block { text-align: center; position: relative; z-index: 2; margin-bottom: 10px; }
        .poster-title { font-size: 16px; font-weight: 900; color: #180a00; letter-spacing: 0.5px; line-height: 1.25; text-shadow: 0 1px 0 rgba(255,255,255,0.25); word-break: break-word; }
        .poster-creator { font-size: 10px; color: #6a4a1a; letter-spacing: 1.5px; margin-top: 4px; font-style: italic; font-family: var(--font-body); }

        /* ── Divider ─────────────────────────────────────────── */
        .poster-divider { text-align: center; color: #7a5c18; font-size: 12px; margin: 6px 0; display: flex; align-items: center; gap: 6px; position: relative; z-index: 2; }
        .poster-divider::before, .poster-divider::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, #8b6820, transparent); }

        /* ── Meta rows ───────────────────────────────────────── */
        .poster-meta { display: flex; flex-direction: column; gap: 5px; position: relative; z-index: 2; }
        .poster-meta-row { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #3a2010; font-family: var(--font-body); }
        .poster-session-open { color: #1f5f35; font-weight: 700; }
        .poster-meta-level { font-weight: 700; color: #5a3010; letter-spacing: 0.3px; }
        .level-icon { font-size: 12px; line-height: 1; }
        .poster-reward { font-weight: 600; color: #6a3a08; }

        /* ── Notice preview ──────────────────────────────────── */
        .poster-notice-preview {
          font-size: 11px; font-family: var(--font-body);
          color: #3a2010; line-height: 1.55;
          margin-bottom: 6px; position: relative; z-index: 2;
          font-style: italic;
        }
        .poster-poll-hint {
          font-size: 10px; color: #5a4010;
          background: rgba(139,90,20,0.1);
          border: 1px dashed #9a7820;
          border-radius: 2px; padding: 3px 6px;
          margin-bottom: 6px; position: relative; z-index: 2;
          font-family: var(--font-body);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* ── Reaction bar ────────────────────────────────────── */
        .reaction-bar {
          display: flex; flex-wrap: wrap; gap: 4px;
          align-items: center;
          margin-top: 8px; padding-top: 8px;
          border-top: 1px dashed rgba(139,90,20,0.3);
          position: relative; z-index: 2;
        }
        .reaction-pill {
          display: flex; align-items: center; gap: 3px;
          padding: 2px 7px; border-radius: 10px;
          background: rgba(139,90,20,0.12);
          border: 1px solid rgba(139,90,20,0.25);
          font-size: 13px; cursor: pointer;
          transition: all 0.15s; line-height: 1;
        }
        .reaction-pill:hover { background: rgba(139,90,20,0.25); border-color: rgba(139,90,20,0.5); }
        .reaction-mine { background: rgba(139,90,20,0.28); border-color: #9a7820; }
        .reaction-count { font-size: 10px; font-family: var(--font-body); color: #5a3a10; font-weight: 700; }
        .reaction-picker-wrap { position: relative; }
        .reaction-add-btn {
          width: 24px; height: 24px; border-radius: 50%;
          background: rgba(139,90,20,0.1); border: 1px dashed rgba(139,90,20,0.4);
          color: #6a4a20; font-size: 14px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s; line-height: 1;
        }
        .reaction-add-btn:hover { background: rgba(139,90,20,0.25); }
        .reaction-picker {
          position: absolute; bottom: 28px; left: 0;
          background: #f2dfa0;
          border: 1px solid #9a7820; border-radius: 6px;
          padding: 6px; display: flex; gap: 4px; flex-wrap: wrap;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          z-index: 20; min-width: 120px;
        }
        .reaction-option {
          font-size: 18px; background: none; border: none; cursor: pointer;
          padding: 3px; border-radius: 4px; transition: background 0.1s;
          line-height: 1;
        }
        .reaction-option:hover { background: rgba(139,90,20,0.2); }

        /* ── Inline poll ─────────────────────────────────────── */
        .inline-poll {
          margin-bottom: 10px;
          padding: 8px;
          background: rgba(139,90,20,0.07);
          border: 1px dashed #9a7820;
          border-radius: 2px;
          position: relative; z-index: 2;
        }
        .inline-poll-question {
          font-size: 11px; font-weight: 700; color: #3a2010;
          font-family: var(--font-body); margin-bottom: 8px;
        }
        .inline-poll-options { display: flex; flex-direction: column; gap: 5px; }
        .poll-option {
          position: relative; overflow: hidden;
          text-align: left; padding: 5px 8px;
          border-radius: 2px;
          border: 1px solid rgba(139,90,20,0.25);
          background: rgba(255,255,255,0.25);
          cursor: pointer; transition: border-color 0.15s;
          display: flex; align-items: center; justify-content: space-between;
          min-height: 28px;
        }
        .poll-option:hover { border-color: #9a7820; }
        .poll-option-voted { border-color: #7a5010; background: rgba(139,90,20,0.15); }
        .poll-option-bar {
          position: absolute; left: 0; top: 0; height: 100%;
          background: rgba(139,90,20,0.15);
          transition: width 0.4s ease;
          pointer-events: none;
        }
        .poll-option-text { font-size: 11px; font-family: var(--font-body); color: #2a1a08; position: relative; z-index: 1; }
        .poll-option-pct { font-size: 10px; font-family: var(--font-body); color: #6a4a20; font-weight: 700; position: relative; z-index: 1; }
        .inline-poll-total { font-size: 10px; color: #7a5a2a; font-family: var(--font-body); text-align: right; margin-top: 5px; }

        /* ── Toggle ──────────────────────────────────────────── */
        .poster-toggle { display: flex; align-items: center; justify-content: center; width: 100%; margin-top: 6px; background: none; border: none; color: #6a4a20; position: relative; z-index: 2; opacity: 0.65; transition: opacity 0.15s; }
        .poster-toggle:hover { opacity: 1; }

        /* ── Expanded detail ─────────────────────────────────── */
        .poster-detail { position: relative; z-index: 2; border-top: 1px dashed #9a7830; padding-top: 10px; margin-top: 4px; }
        .poster-location { font-size: 11px; font-family: var(--font-body); color: #5a3820; font-style: italic; margin-bottom: 8px; padding: 4px 6px; background: rgba(139,90,20,0.07); border-radius: 2px; }
        .poster-description { font-size: 12px; font-family: var(--font-body); color: #2a1a08; line-height: 1.65; margin-bottom: 10px; font-style: italic; }
        .poster-participants-panel { margin-bottom: 10px; padding: 8px; background: rgba(80,45,12,0.08); border: 1px dashed #9a7820; border-radius: 2px; }
        .poster-panel-title { font-size: 10px; color: #5a3a10; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
        .poster-participant-list { display: grid; gap: 5px; }
        .poster-participant-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 7px; align-items: center; min-width: 0; }
        .poster-participant-token { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #5a3010; color: #f1d890; font-size: 11px; font-weight: 800; box-shadow: 0 1px 5px rgba(0,0,0,0.35); }
        .poster-participant-token img { width: 100%; height: 100%; object-fit: cover; }
        .poster-participant-copy { min-width: 0; display: flex; flex-direction: column; }
        .poster-participant-name { font-size: 12px; color: #251404; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .poster-participant-sub { font-size: 10px; color: #6a4a20; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .poster-participant-gm .poster-participant-token { box-shadow: 0 0 0 1px #c9a84c, 0 1px 5px rgba(0,0,0,0.35); }
        .poster-participant-state { font-size: 9px; color: #7a2020; border: 1px solid rgba(122,32,32,0.35); border-radius: 2px; padding: 1px 4px; }

        /* ── Stars ───────────────────────────────────────────── */
        .poster-stars { display: flex; align-items: center; justify-content: center; gap: 2px; margin-bottom: 8px; }
        .star-btn { background: none; border: none; font-size: 15px; color: #9a7820; cursor: pointer; padding: 1px; transition: color 0.1s; }
        .star-btn.star-lit, .star-btn:hover { color: #c9880a; }
        .poster-avg-rating { font-size: 12px; color: #8b5a10; margin-left: 4px; font-family: var(--font-body); }

        /* ── Action buttons ──────────────────────────────────── */
        .poster-actions { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-bottom: 8px; }
        .poster-queue-full { font-size: 10px; color: #8b2020; font-weight: 700; letter-spacing: 1px; font-family: var(--font-display); }
        .poster-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 2px; font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; transition: all 0.15s; }
        .poster-btn-primary { background: #6b1010; color: #f5d0a0; border: 1px solid #4a0808; }
        .poster-btn-primary:hover:not(:disabled) { background: #8b2020; }
        .poster-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .poster-btn-outline { background: rgba(139,90,20,0.1); color: #4a2a08; border: 1px solid #9a7820; }
        .poster-btn-outline:hover { background: rgba(139,90,20,0.22); }
        .poster-btn-danger { background: transparent; color: #7a2020; border: 1px solid #6a2020; }
        .poster-btn-danger:hover { background: rgba(139,32,32,0.15); }

        /* ── Edit form ───────────────────────────────────────── */
        .poster-edit-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding: 8px; background: rgba(139,90,20,0.07); border: 1px dashed #9a7820; border-radius: 2px; }
        .poster-edit-form input, .poster-edit-form textarea { background: rgba(255,255,255,0.38); border: 1px solid #9a7820; color: #2a1a08; font-size: 11px; padding: 5px 8px; border-radius: 2px; }
        .poster-edit-form input:focus, .poster-edit-form textarea:focus { outline: none; border-color: #6b4010; box-shadow: none; }

        /* ── Invite list ─────────────────────────────────────── */
        .poster-invite-list { margin-top: 8px; padding: 8px; background: rgba(139,90,20,0.07); border: 1px dashed #9a7820; border-radius: 2px; }
        .poster-invite-label { font-size: 10px; color: #6a4a20; letter-spacing: 0.5px; margin-bottom: 6px; text-transform: uppercase; }
        .poster-invite-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(139,90,20,0.18); font-size: 11px; font-family: var(--font-body); color: #2a1a08; }
        .poster-invite-player { display: flex; align-items: center; gap: 7px; min-width: 0; }
        .poster-invite-avatar { width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #5a3010; color: #f1d890; font-size: 11px; font-weight: 800; box-shadow: 0 1px 5px rgba(0,0,0,0.28); }
        .poster-invite-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .poster-invite-copy { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
        .poster-invite-name { color: #251404; font-size: 11px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .poster-invite-character { color: #6a4a20; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* ── Corner aging ────────────────────────────────────── */
        .poster-corner { position: absolute; width: 16px; height: 16px; pointer-events: none; z-index: 3; }
        .poster-corner-tl { top:0; left:0; background: radial-gradient(circle at 0% 0%, transparent 55%, rgba(60,30,5,0.45) 100%); }
        .poster-corner-tr { top:0; right:0; background: radial-gradient(circle at 100% 0%, transparent 55%, rgba(60,30,5,0.45) 100%); }
        .poster-corner-bl { bottom:0; left:0; background: radial-gradient(circle at 0% 100%, transparent 55%, rgba(60,30,5,0.45) 100%); }
        .poster-corner-br { bottom:0; right:0; background: radial-gradient(circle at 100% 100%, transparent 55%, rgba(60,30,5,0.45) 100%); }
      `}</style>
    </div>

    {showJoinModal && (
      <JoinMissionModal
        mission={mission}
        playersFull={playersFull}
        onClose={() => setShowJoinModal(false)}
        onJoined={handleJoined}
      />
    )}
  </>
  );
});
