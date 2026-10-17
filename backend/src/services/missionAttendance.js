import { transaction, query } from '../db/index.js';
import { fail, requireUuid, managesMission, requireManager } from './missionRules.js';
import { lockedMission, history } from './missionBoard.js';
async function sessionMission(client, sessionId) {
  requireUuid(sessionId);
  const session = (await client.query('SELECT * FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [sessionId])).rows[0];
  if (!session?.mission_id) fail(404, 'Sessão de missão não encontrada.');
  const mission = await lockedMission(client, session.mission_id);
  // Mission lock always precedes session/attendance writes, including simultaneous close.
  const current = (await client.query('SELECT * FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [sessionId])).rows[0];
  return {
    session: current,
    mission
  };
}
export async function attendanceList(sessionId, user) {
  requireUuid(sessionId);
  const session = (await query('SELECT * FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [sessionId])).rows[0];
  if (!session?.mission_id) fail(404, 'Sessão não encontrada.');
  const mission = (await query('SELECT * FROM missions WHERE id=$1', [session.mission_id])).rows[0];
  const participant = (await query("SELECT 1 FROM mission_participants WHERE mission_id=$1 AND user_id=$2 AND approval_status='APPROVED' AND type='PLAYER'", [mission.id, user.id])).rows[0];
  if (!managesMission(mission, user) && !participant && !(session.player_ids || []).includes(user.id)) fail(403, 'Sem acesso à lista de presença.');
  // Snapshot player_ids preserves session roster after later mission departures.
  return (await query(`SELECT u.id AS user_id,COALESCE(u.display_name,u.name) AS name,
    sa.character_id,sa.confirmed_at,sa.confirmed_by,sa.confirmation_source,sa.entered_at,sa.left_at,sa.last_seen_at,
    (sa.left_at IS NULL AND sa.last_seen_at > NOW()-INTERVAL '90 seconds') AS connected
    FROM users u LEFT JOIN session_attendance sa ON sa.user_id=u.id AND sa.session_id=$1
    WHERE u.id=ANY($2::uuid[]) ORDER BY COALESCE(u.display_name,u.name)`, [sessionId, session.player_ids])).rows;
}
export async function confirmAttendance(sessionId, user, targetId, confirmed, reason = null) {
  requireUuid(targetId);
  if (typeof confirmed !== 'boolean') fail(400, 'confirmed deve ser booleano.');
  return transaction(async client => {
    const {
      session,
      mission
    } = await sessionMission(client, sessionId);
    const own = targetId === user.id;
    if (!own) requireManager(mission, user);
    if (own && (!confirmed || session.status !== 'open')) fail(409, 'A própria presença só pode ser confirmada em sessão aberta.');
    if (!own && !reason?.trim()) fail(400, 'Correção administrativa exige motivo.');
    if (!(session.player_ids || []).includes(targetId)) fail(403, 'Esta conta não está na lista de jogadores desta sessão.');
    const entry = (await client.query('SELECT * FROM session_attendance WHERE session_id=$1 AND user_id=$2', [sessionId, targetId])).rows[0];
    if (Boolean(entry?.confirmed_at) === confirmed) return entry;
    const participant = (await client.query('SELECT character_id FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [mission.id, targetId])).rows[0];
    const attendance = (await client.query(`INSERT INTO session_attendance(session_id,mission_id,user_id,character_id,left_at,confirmed_at,confirmed_by,confirmation_source)
      VALUES($1,$2,$3,$4,NOW(),CASE WHEN $5 THEN NOW() ELSE NULL END,$6,$7)
      ON CONFLICT(session_id,user_id) DO UPDATE SET confirmed_at=CASE WHEN $5 THEN NOW() ELSE NULL END,
      confirmed_by=$6,confirmation_source=$7,character_id=COALESCE(session_attendance.character_id,EXCLUDED.character_id) RETURNING *`, [sessionId, mission.id, targetId, participant?.character_id || null, confirmed, user.id, own ? 'SELF' : 'MANAGER'])).rows[0];
    await client.query(`INSERT INTO session_events(session_id,mission_id,event_type,player_id,payload)
      VALUES($1,$2,$3,$4,$5)`, [sessionId, mission.id, confirmed ? 'ATTENDANCE_CONFIRMED' : 'ATTENDANCE_REVOKED', targetId, JSON.stringify({
      authorId: user.id,
      reason,
      source: own ? 'SELF' : 'MANAGER'
    })]);
    await history(client, mission, user, 'ATTENDANCE', reason, {
      sessionId,
      userId: targetId,
      confirmed
    });
    return attendance;
  });
}
export async function recordConnection(sessionId, {
  userId,
  actorId,
  eventType
}) {
  if (!['enter', 'leave', 'reconnect', 'heartbeat'].includes(eventType)) fail(400, 'Evento de conexão inválido.');
  return transaction(async client => {
    const {
      session,
      mission
    } = await sessionMission(client, sessionId);
    if (session.status !== 'open') fail(409, 'Sessão encerrada.');
    let pc;
    if (!userId && actorId) {
      pc = (await client.query('SELECT id,user_id FROM player_characters WHERE foundry_actor_id=$1 AND active=TRUE', [actorId])).rows[0];
      userId = pc?.user_id;
    }
    if (!userId || !(session.player_ids || []).includes(userId)) return {
      persisted: false,
      reason: 'Conta não vinculada ou fora da lista da sessão.'
    };
    const characterId = pc?.id || (await client.query('SELECT character_id FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [mission.id, userId])).rows[0]?.character_id || null;
    const type = {
      enter: 'PLAYER_CONNECTED',
      leave: 'PLAYER_DISCONNECTED',
      reconnect: 'PLAYER_RECONNECTED',
      heartbeat: 'PLAYER_HEARTBEAT'
    }[eventType];
    await client.query('INSERT INTO session_events(session_id,mission_id,event_type,player_id,character_id,payload) VALUES($1,$2,$3,$4,$5,$6)', [sessionId, mission.id, type, userId, characterId, JSON.stringify({
      connectionOnly: true
    })]);
    await client.query(`INSERT INTO session_attendance(session_id,mission_id,user_id,character_id,left_at,last_seen_at)
      VALUES($1,$2,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END,NOW())
      ON CONFLICT(session_id,user_id) DO UPDATE SET last_seen_at=NOW(),left_at=CASE WHEN $5 THEN NOW() ELSE NULL END`, [sessionId, mission.id, userId, characterId, eventType === 'leave']);
    return {
      persisted: true,
      userId
    };
  });
}
