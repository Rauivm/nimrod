import { useToast } from './ui.jsx';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth, isGM } from '../contexts/AuthContext.jsx';
import JoinMissionModal from './JoinMissionModal.jsx';
import '../styles/mission-controls.css';
import { useWs } from '../contexts/WsContext.jsx';
const localDate = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const states = {
  OPEN: 'Aguardando início',
  CLOSED: 'Aguardando início',
  RUNNING: 'Sessão ativa',
  PAUSED: 'Aguardando próxima sessão',
  FINISHED: 'Concluída',
  CANCELLED: 'Cancelada'
};
export default function MissionActions({
  mission,
  onChange
}) {
  const {
    on
  } = useWs();
  const {
    user
  } = useAuth();
  const notify = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [gmUsers, setGmUsers] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [history, setHistory] = useState(null);
  const [reason, setReason] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [foundryCode, setFoundryCode] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  const manager = user?.id === mission.creator_id || user?.id === mission.gm_id;
  const creator = user?.id === mission.creator_id;
  const pending = mission.user_approval_status === 'PENDING';
  const mutable = ['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status);
  const open = mutable && mission.registrations_open && (!mission.registration_deadline || new Date(mission.registration_deadline) > new Date());
  const full = Number(mission.player_count) >= mission.max_players && Number(mission.reserve_count) >= mission.max_reserves;
  const set = (key, value) => setForm(prev => ({
    ...prev,
    [key]: value
  }));
  async function run(work) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    onChange(await api.get(`/missions/${mission.id}`));
  }
  async function action(name, body = {}) {
    if (['finish', 'reopen', 'reactivate', 'cancel'].includes(name) && !window.confirm('Confirmar esta alteração de estado da missão?')) return;
    await run(async () => {
      const result = await api.post(`/missions/${mission.id}/${name}`, {
        ...body,
        ...(name === 'start' && foundryCode ? {
          code: foundryCode
        } : {}),
        reason,
        confirmed: true
      });
      onChange(result.mission || result);
      setAttendance(null);
      notify('Estado da missão atualizado.');
    });
  }
  function edit() {
    setForm({
      title: mission.title,
      description: mission.description,
      reward: mission.reward || '',
      minPlayers: mission.min_players ?? '',
      maxPlayers: mission.max_players,
      maxReserves: mission.max_reserves,
      minLevel: mission.min_level ?? '',
      maxLevel: mission.max_level ?? '',
      approvalRequired: mission.approval_required,
      datetime: localDate(mission.datetime),
      registrationDeadline: localDate(mission.registration_deadline)
    });
    setEditing(true);
  }
  async function applyGm() {
    await run(async () => {
      let result = await api.post(`/missions/${mission.id}/gm-requests`, {
        kind: 'APPLICATION'
      });
      if (creator) {
        const entry = result.gmRequests.find(r => r.user_id === user.id && r.status === 'PENDING' && r.kind === 'APPLICATION');
        result = await api.patch(`/missions/${mission.id}/gm-requests/${entry.id}`, {
          accept: true
        });
      }
      onChange(result);
    });
  }
  const session = (mission.sessions || []).find(s => s.id === selectedSessionId) || mission.activeSession || mission.lastSession;
  const attendanceVisible = attendance !== null;
  useEffect(() => {
    if (!attendanceVisible || !session?.id) return;
    const refresh = ({
      sessionId
    }) => {
      if (sessionId === session.id) api.get(`/sessions/${session.id}/attendance`).then(setAttendance).catch(e => setError(e.message));
    };
    const unsubscribePresence = on('SESSION_ATTENDANCE_UPDATED', refresh);
    const unsubscribeConnection = on('SESSION_CONNECTION_UPDATED', refresh);
    return () => {
      unsubscribePresence();
      unsubscribeConnection();
    };
  }, [on, session?.id, attendanceVisible]);
  const button = (label, handler, disabled = false) => <button type="button" className="poster-btn poster-btn-outline" disabled={busy || disabled} onClick={handler}>{label}</button>;
  return <section className="mission-controls" aria-label="Gerenciamento da missão" aria-busy={busy}>
    <p>{states[mission.status]} · Inscrições {open ? 'abertas' : 'encerradas'} · Narrador {mission.gm_id ? `designado: ${mission.gm_name || 'GM'}` : 'a definir'}</p>
    <p>Jogadores: {mission.min_players ?? '?'}–{mission.max_players} · Reservas: {mission.max_reserves} · Níveis: {mission.min_level ?? '?'}–{mission.max_level ?? '?'}</p>
    {mission.registration_deadline && <p>Inscrições até {new Date(mission.registration_deadline).toLocaleString('pt-BR')}</p>}
    {error && <p role="alert" className="ui-error">{error}</p>}
    <div className="poster-actions">
      {mission.user_joined && mutable && <>{pending && <span>Aguardando aprovação</span>}{button('Desistir', () => run(async () => {
          await api.delete(`/missions/${mission.id}/join`);
          await refresh();
          notify('Você saiu da missão.');
        }))}
        {button('Selecionar personagem', () => setJoining(true))}</>}
      {!mission.user_joined && open && !full && button(mission.approval_required ? 'Solicitar inscrição' : 'Participar', () => setJoining(true))}
      {!mission.user_joined && mutable && full && !mission.watching && button('Avise-me quando surgir uma vaga', () => run(async () => {
        await api.post(`/missions/${mission.id}/alerts`, {
          emailEnabled
        });
        await refresh();
      }))}
      {mission.watching && button('Cancelar alerta', () => run(async () => {
        await api.delete(`/missions/${mission.id}/alerts`);
        await refresh();
      }))}
      {isGM(user) && mutable && user?.id !== mission.gm_id && button(creator ? 'Assumir narração' : 'Candidatar-me a narrador', applyGm)}
      {manager && !['FINISHED', 'CANCELLED'].includes(mission.status) && button('Editar missão', edit)}
      {creator && mutable && button('Convidar narrador', () => run(async () => setGmUsers((await api.get('/users')).filter(isGM))))}
      {manager && mutable && button(open ? 'Encerrar inscrições' : 'Reabrir inscrições', () => action(open ? 'close-registrations' : 'open-registrations'))}
      {manager && mutable && button(mission.status === 'PAUSED' ? 'Iniciar próxima sessão' : 'Iniciar sessão', () => action('start'))}
      {manager && mission.status === 'RUNNING' && button('Encerrar sessão e pausar', () => action('pause'))}
      {manager && ['RUNNING', 'PAUSED'].includes(mission.status) && button('Concluir aventura', () => action('finish'))}
      {manager && mutable && button('Cancelar missão', () => action('cancel'), !reason.trim())}
      {manager && mission.status === 'FINISHED' && button('Reabrir aventura', () => action('reopen'), !reason.trim())}
      {manager && mission.status === 'CANCELLED' && button('Reativar missão', () => action('reactivate'), !reason.trim())}
      {manager && button('Histórico', () => run(async () => setHistory(await api.get(`/missions/${mission.id}/history`))))}
      {session && button('Lista de presença', () => run(async () => setAttendance(await api.get(`/sessions/${session.id}/attendance`))))}
    </div>
    {!mission.user_joined && mutable && full && !mission.watching && <label>
      <input type="checkbox" checked={emailEnabled} disabled={!mission.emailAlertsAvailable} onChange={e => setEmailEnabled(e.target.checked)} />
      Também receber e-mail {mission.emailAlertsAvailable ? '' : '(transporte não configurado; alerta interno disponível)'}
    </label>}
    {(mission.sessions || []).length > 0 && <label>Histórico de sessões
      <select value={session?.id || ''} onChange={e => {
        setSelectedSessionId(e.target.value);
        setAttendance(null);
      }}>
        {mission.sessions.map(s => <option key={s.id} value={s.id}>Sessão {s.sessionNumber} · {new Date(s.startedAt).toLocaleString('pt-BR')} · {s.status === 'open' ? 'ativa' : 'encerrada'}</option>)}
      </select>
    </label>}
    {manager && <label>Motivo administrativo (obrigatório para cancelamento, reabertura e correções)
      <input aria-label="Motivo administrativo" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></label>}
    {manager && !['FINISHED', 'CANCELLED'].includes(mission.status) && <details><summary>Vincular Foundry por código (alternativa)</summary>
      <p>Use o código mostrado ao GM no Foundry se a identificação automática não estiver disponível. Ele não concede permissões.</p>
      <label>Código Foundry<input value={foundryCode} maxLength={7} onChange={e => setFoundryCode(e.target.value.toUpperCase())} /></label>
      {mission.activeSession && button('Vincular sessão ativa', () => run(async () => {
        await api.post(`/sessions/${mission.activeSession.id}/link-foundry`, {
          code: foundryCode
        });
        setLinkMessage('Sessão vinculada ao Foundry.');
      }), !foundryCode.trim())}
      <p role="status">{linkMessage}</p>
    </details>}
    {editing && <form className="poster-edit-form" onSubmit={e => {
      e.preventDefault();
      run(async () => {
        onChange(await api.patch(`/missions/${mission.id}`, {
          ...form,
          datetime: form.datetime ? new Date(form.datetime).toISOString() : null,
          registrationDeadline: form.registrationDeadline ? new Date(form.registrationDeadline).toISOString() : null
        }));
        setEditing(false);
        notify('Missão atualizada.');
      });
    }}>
      <label>Título<input value={form.title} onChange={e => set('title', e.target.value)} required /></label>
      <label>Descrição<textarea value={form.description} onChange={e => set('description', e.target.value)} required /></label>
      <label>Recompensa<input value={form.reward} onChange={e => set('reward', e.target.value)} /></label>
      {[['minPlayers', 'Mínimo de jogadores', 1], ['maxPlayers', 'Máximo de jogadores', 1], ['maxReserves', 'Reservas', 0], ['minLevel', 'Nível mínimo', 1], ['maxLevel', 'Nível máximo', 1]].map(([key, label, min]) => <label key={key}>{label}<input type="number" min={min} value={form[key]} onChange={e => set(key, e.target.value)} required /></label>)}
      <label><input type="checkbox" checked={form.approvalRequired} onChange={e => set('approvalRequired', e.target.checked)} /> Exigir aprovação</label>
      <label>Agendamento opcional<input type="datetime-local" value={form.datetime} onChange={e => set('datetime', e.target.value)} /></label>
      <label>Prazo opcional<input type="datetime-local" value={form.registrationDeadline} onChange={e => set('registrationDeadline', e.target.value)} /></label>
      <button className="poster-btn poster-btn-primary" disabled={busy}>Salvar</button>{button('Fechar edição', () => setEditing(false))}
    </form>}
    {gmUsers && <div><h4>Convidar conta GM</h4>{gmUsers.map(g => <div key={g.id}>{g.displayName || g.display_name || g.name} {button('Convidar', () => run(async () => {
          onChange(await api.post(`/missions/${mission.id}/invite`, {
            userId: g.id,kind:'GM'
          }));
          setGmUsers(null);
        }))}</div>)}{button('Fechar lista', () => setGmUsers(null))}</div>}
    {(mission.gmRequests || []).filter(r => r.status === 'PENDING').map(r => <div key={r.id}>{r.kind === 'INVITE' ? 'Convite' : 'Candidatura'}: {r.name}
      {(r.kind === 'INVITE' && r.user_id === user?.id || r.kind === 'APPLICATION' && creator) && <>{button('Aceitar', () => run(async () => onChange(await api.patch(`/missions/${mission.id}/gm-requests/${r.id}`, {
          accept: true
        }))))}{button('Rejeitar', () => run(async () => onChange(await api.patch(`/missions/${mission.id}/gm-requests/${r.id}`, {
          accept: false
        }))))}</>}
    </div>)}
    {manager && mutable && <div><h4>Inscrições</h4>{(mission.participants || []).map(p => <div key={p.userId}>
      {p.playerName} · {p.approvalStatus === 'PENDING' ? 'Solicitação pendente' : p.type === 'RESERVE' ? 'Reserva aprovada' : 'Confirmado'}
      {p.approvalStatus === 'PENDING' && button('Aprovar', () => run(async () => {
          await api.patch(`/missions/${mission.id}/participants/${p.userId}`, {
            action: 'APPROVE'
          });
          await refresh();
        }))}
      {button(p.approvalStatus === 'PENDING' ? 'Rejeitar' : 'Remover', () => run(async () => {
          await api.patch(`/missions/${mission.id}/participants/${p.userId}`, {
            action: p.approvalStatus === 'PENDING' ? 'REJECT' : 'REMOVE',
            reason
          });
          await refresh();
        }))}
    </div>)}</div>}
    {attendance && <div><h4>Presença — sessão {session?.sessionNumber}</h4>{attendance.map(p => <div key={p.user_id}>
      {p.name} · {p.connected ? 'conectado' : 'desconectado'} · {p.confirmed_at ? 'presença confirmada' : 'presença não confirmada'}
      {p.user_id === user?.id && !p.confirmed_at && session.status === 'open' && button('Confirmar minha presença', () => run(async () => {
          await api.post(`/sessions/${session.id}/attendance`, {
            confirmed: true
          });
          setAttendance(await api.get(`/sessions/${session.id}/attendance`));
        }))}
      {manager && button(p.confirmed_at ? 'Revogar presença' : 'Validar presença', () => run(async () => {
          await api.post(`/sessions/${session.id}/attendance`, {
            userId: p.user_id,
            confirmed: !p.confirmed_at,
            reason
          });
          setAttendance(await api.get(`/sessions/${session.id}/attendance`));
        }), !reason.trim())}
    </div>)}</div>}
    {history && <details open><summary>Histórico administrativo</summary><ol>{history.map(h => <li key={h.id}>{new Date(h.created_at).toLocaleString('pt-BR')} · {h.action} {h.reason && `— ${h.reason}`}</li>)}</ol></details>}
    {joining && <JoinMissionModal mission={mission} playersFull={Number(mission.player_count) >= mission.max_players} characterOnly={mission.user_joined} onClose={() => setJoining(false)} onJoined={result => { onChange(result.mission); notify(mission.user_joined ? 'Personagem atualizado.' : mission.approval_required ? 'Inscrição enviada para aprovação.' : 'Inscrição confirmada.'); }} />}
    {mission.watching && <small>Alerta interno ativo, sem reserva de vaga. E-mail indisponível: transporte não configurado.</small>}
  </section>;
}
