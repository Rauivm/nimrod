import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Users, MapPin, Calendar, Coins, Star, ChevronDown, ChevronUp, Crown, Shield, Edit3, Trash2, X, Check, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

function StarRating({ missionId, avgRating, ratingCount, canRate, onRated }) {
  const [hovered, setHovered] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const rate = async (stars) => {
    setSubmitting(true);
    try {
      await api.post(`/missions/${missionId}/rate`, { stars });
      onRated?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {canRate && (
        <div style={{ display: 'flex', gap: '2px' }}>
          {[1,2,3,4,5].map(s => (
            <button
              key={s}
              onClick={() => rate(s)}
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              disabled={submitting}
              style={{
                background: 'none', border: 'none', padding: '2px',
                color: s <= (hovered || 0) ? 'var(--gold)' : 'var(--text-faint)',
                fontSize: '16px', cursor: 'pointer', transition: 'color 0.1s'
              }}
            >★</button>
          ))}
        </div>
      )}
      {avgRating > 0 && (
        <span style={{ color: 'var(--gold)', fontSize: '13px' }}>
          ★ {parseFloat(avgRating).toFixed(1)} <span style={{ color: 'var(--text-muted)' }}>({ratingCount})</span>
        </span>
      )}
    </div>
  );
}

export function MissionCard({ mission, onUpdate, compact = false }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});

  const isCreator = user?.id === mission.creator_id;
  const isGM = user?.role === 'GM';
  const canManage = isCreator || isGM;

  const playerCount = parseInt(mission.player_count) || 0;
  const reserveCount = parseInt(mission.reserve_count) || 0;
  const playersFull = playerCount >= mission.max_players;
  const reservesFull = reserveCount >= mission.max_reserves;

  const statusColors = {
    OPEN: '#2a8a58',
    CLOSED: '#7a6430',
    FINISHED: '#4a4030'
  };
  const statusLabel = { OPEN: 'Aberta', CLOSED: 'Fechada', FINISHED: 'Concluída' };

  const join = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/missions/${mission.id}/join`, {});
      onUpdate?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const leave = async () => {
    setLoading(true);
    try {
      await api.delete(`/missions/${mission.id}/join`);
      onUpdate?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const setStatus = async (status) => {
    setLoading(true);
    try {
      await api.patch(`/missions/${mission.id}`, { status });
      onUpdate?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const deleteMission = async () => {
    if (!confirm('Apagar esta missão?')) return;
    try {
      await api.delete(`/missions/${mission.id}`);
      onUpdate?.();
    } catch (e) { alert(e.message); }
  };

  const loadUsers = async () => {
    const us = await api.get('/users');
    setUsers(us);
    setShowInvite(true);
  };

  const invite = async (userId) => {
    try {
      await api.post(`/missions/${mission.id}/invite`, { userId });
      onUpdate?.();
      setShowInvite(false);
    } catch (e) { alert(e.message); }
  };

  const saveEdit = async () => {
    try {
      await api.patch(`/missions/${mission.id}`, editData);
      onUpdate?.();
      setEditing(false);
    } catch (e) { alert(e.message); }
  };

  const datetime = new Date(mission.datetime);
  const isFinished = mission.status === 'FINISHED';
  const isClosed = mission.status === 'CLOSED';

  return (
    <div className={`mission-card ${isFinished || isClosed ? 'greyed' : ''}`}>
      <div className="mission-header">
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{
              fontSize: '10px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: '2px',
              background: `${statusColors[mission.status]}20`,
              color: statusColors[mission.status],
              border: `1px solid ${statusColors[mission.status]}40`
            }}>{statusLabel[mission.status]}</span>
            {mission.avg_rating > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--gold)' }}>
                ★ {parseFloat(mission.avg_rating).toFixed(1)}
              </span>
            )}
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', color: 'var(--gold-bright)', fontWeight: '600' }}>
            {mission.title}
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>por {mission.creator_name}</span>
        </div>

        <button onClick={() => setExpanded(!expanded)} style={{
          background: 'none', color: 'var(--text-muted)', padding: '4px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)'
        }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <div className="mission-meta">
        <span><Calendar size={12} /> {format(datetime, "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
        <span><MapPin size={12} /> {mission.meeting_location}</span>
        <span><Users size={12} />
          <span style={{ color: playersFull ? 'var(--crimson-bright)' : 'var(--emerald-bright)' }}>
            {playerCount}/{mission.max_players}
          </span>
          {mission.max_reserves > 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              {' '}+{reserveCount}/{mission.max_reserves} reserva
            </span>
          )}
        </span>
        {mission.reward && <span><Coins size={12} /> {mission.reward}</span>}
      </div>

      {expanded && (
        <div className="mission-expanded animate-in">
          <p style={{ color: 'var(--text)', lineHeight: '1.7', marginBottom: '12px' }}>{mission.description}</p>

          {isFinished && (
            <StarRating
              missionId={mission.id}
              avgRating={mission.avg_rating}
              ratingCount={mission.rating_count}
              canRate={mission.user_joined}
              onRated={onUpdate}
            />
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {/* Join/Leave */}
            {!canManage && mission.status === 'OPEN' && (
              mission.user_joined ? (
                <button onClick={leave} disabled={loading} className="btn-outline-sm">
                  Sair
                </button>
              ) : (
                <button onClick={join} disabled={loading} className="btn-primary-sm">
                  {playersFull && !reservesFull ? 'Entrar na Reserva' :
                   playersFull && reservesFull ? 'Fila Cheia' : 'Participar'}
                </button>
              )
            )}

            {/* Management */}
            {canManage && (
              <>
                {mission.status === 'OPEN' && (
                  <>
                    <button onClick={() => setStatus('CLOSED')} disabled={loading} className="btn-outline-sm">
                      <X size={12} /> Fechar
                    </button>
                    <button onClick={() => { setEditing(true); setEditData({ title: mission.title, description: mission.description, meetingLocation: mission.meeting_location, reward: mission.reward }); }} className="btn-outline-sm">
                      <Edit3 size={12} /> Editar
                    </button>
                    <button onClick={loadUsers} className="btn-outline-sm">
                      <UserPlus size={12} /> Convidar
                    </button>
                  </>
                )}
                {mission.status === 'CLOSED' && (
                  <button onClick={() => setStatus('FINISHED')} disabled={loading} className="btn-primary-sm">
                    <Check size={12} /> Concluir
                  </button>
                )}
                <button onClick={deleteMission} className="btn-danger-sm">
                  <Trash2 size={12} /> Apagar
                </button>
              </>
            )}
          </div>

          {editing && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <input value={editData.title || ''} onChange={e => setEditData(p => ({...p, title: e.target.value}))} placeholder="Título" />
              <textarea value={editData.description || ''} onChange={e => setEditData(p => ({...p, description: e.target.value}))} placeholder="Descrição" />
              <input value={editData.meetingLocation || ''} onChange={e => setEditData(p => ({...p, meetingLocation: e.target.value}))} placeholder="Local" />
              <input value={editData.reward || ''} onChange={e => setEditData(p => ({...p, reward: e.target.value}))} placeholder="Recompensa" />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={saveEdit} className="btn-primary-sm">Salvar</button>
                <button onClick={() => setEditing(false)} className="btn-outline-sm">Cancelar</button>
              </div>
            </div>
          )}

          {showInvite && (
            <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Convidar jogador:</div>
              {users.filter(u => u.id !== user?.id).map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '14px' }}>{u.name}</span>
                  <button onClick={() => invite(u.id)} className="btn-primary-sm">Convidar</button>
                </div>
              ))}
              <button onClick={() => setShowInvite(false)} style={{ marginTop: '8px' }} className="btn-outline-sm">Fechar</button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .mission-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .mission-card:hover { border-color: var(--border-bright); box-shadow: var(--shadow); }
        .mission-card.greyed { opacity: 0.55; }
        .mission-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .mission-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 13px; color: var(--text-muted); }
        .mission-meta span { display: flex; align-items: center; gap: 4px; }
        .mission-expanded { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }

        .btn-primary-sm {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: var(--radius);
          background: var(--crimson); color: #f5d8d8;
          font-size: 12px; font-family: var(--font-display);
          letter-spacing: 0.5px; text-transform: uppercase;
          border: 1px solid rgba(196,48,48,0.3);
          transition: all 0.15s;
        }
        .btn-primary-sm:hover:not(:disabled) { background: var(--crimson-bright); }
        .btn-primary-sm:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-outline-sm {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: var(--radius);
          background: transparent; color: var(--text-muted);
          font-size: 12px; font-family: var(--font-display);
          letter-spacing: 0.5px; text-transform: uppercase;
          border: 1px solid var(--border);
          transition: all 0.15s;
        }
        .btn-outline-sm:hover { border-color: var(--border-bright); color: var(--text); }

        .btn-danger-sm {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: var(--radius);
          background: transparent; color: #8a4040;
          font-size: 12px; font-family: var(--font-display);
          letter-spacing: 0.5px; text-transform: uppercase;
          border: 1px solid #3a2020;
          transition: all 0.15s;
        }
        .btn-danger-sm:hover { background: rgba(139,32,32,0.2); color: var(--crimson-bright); }
      `}</style>
    </div>
  );
}
