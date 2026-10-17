import { transaction, query } from '../db/index.js';
import { isGM } from '../lib/roles.js';
import { createUserNotification as notify } from './notifier/inbox.js';
import { emailAvailable } from './notifier/email.js';
import { fail, requireUuid, requireManager, requireRegistration, validateCharacter, validateMissionFields } from './missionRules.js';
export async function lockedMission(client, id) {
  requireUuid(id);
  const {
    rows
  } = await client.query('SELECT * FROM missions WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) fail(404, 'Missão não encontrada.');
  return rows[0];
}
export async function history(client, mission, user, action, reason = null, details = {}) {
  await client.query('INSERT INTO mission_history(mission_id,actor_id,action,reason,details) VALUES($1,$2,$3,$4,$5)', [mission.id, user.id, action, reason, JSON.stringify(details)]);
}
export async function slotCounts(client, id) {
  const {
    rows
  } = await client.query(`SELECT
    COUNT(*) FILTER (WHERE type='PLAYER')::int AS players,
    COUNT(*) FILTER (WHERE type='RESERVE')::int AS reserves
    FROM mission_participants WHERE mission_id=$1 AND approval_status='APPROVED'`, [id]);
  return rows[0];
}

// Caller holds the mission lock. Never revalidate approved reserves against new levels.
export async function promoteAndAlert(client, mission) {
  if (['RUNNING', 'FINISHED', 'CANCELLED'].includes(mission.status)) return;
  let counts = await slotCounts(client, mission.id);
  while (counts.players < mission.max_players && counts.reserves > 0) {
    const {
      rows
    } = await client.query(`UPDATE mission_participants SET type='PLAYER'
      WHERE id=(SELECT id FROM mission_participants WHERE mission_id=$1 AND type='RESERVE'
      AND approval_status='APPROVED' ORDER BY approved_at, joined_at, id LIMIT 1) RETURNING user_id`, [mission.id]);
    if (!rows[0]) break;
    await notify(client, rows[0].user_id, mission.id, 'PROMOTED', 'Você foi promovido da reserva para uma vaga principal.');
    counts.players++;
    counts.reserves--;
  }
  if (counts.players < mission.max_players || counts.reserves < mission.max_reserves) {
    const {
      rows
    } = await client.query('DELETE FROM mission_vacancy_alerts WHERE mission_id=$1 RETURNING user_id,email_enabled', [mission.id]);
    for (const alert of rows) await notify(client, alert.user_id, mission.id, 'VACANCY', 'Surgiu uma vaga nesta missão. Confira o prazo das inscrições; o alerta não reserva sua vaga.', alert.email_enabled);
  }
}
async function character(client, id) {
  if (!id) return null;
  requireUuid(id);
  const {
    rows
  } = await client.query('SELECT * FROM player_characters WHERE id=$1 FOR SHARE', [id]);
  if (!rows[0]) fail(400, 'Personagem não encontrado.');
  return rows[0];
}
export async function joinMission(id, user, body = {}) {
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    requireRegistration(mission);
    const existing = await client.query('SELECT * FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [id, user.id]);
    if (existing.rows[0]) return {
      joined: true,
      type: existing.rows[0].type,
      approvalStatus: existing.rows[0].approval_status
    };
    validateCharacter(mission, await character(client, body.characterId), user.id);
    await promoteAndAlert(client, mission);
    const counts = await slotCounts(client, id);
    const type = counts.players < mission.max_players ? 'PLAYER' : counts.reserves < mission.max_reserves ? 'RESERVE' : null;
    if (!type) fail(409, 'Vagas principais e reservas esgotadas. Ative um alerta.');
    const status = mission.approval_required ? 'PENDING' : 'APPROVED';
    await client.query(`INSERT INTO mission_participants(mission_id,user_id,type,character_id,approval_status,approved_at)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $5='APPROVED' THEN clock_timestamp() ELSE NULL END)`, [id, user.id, type, body.characterId || null, status]);
    await client.query('DELETE FROM mission_vacancy_alerts WHERE mission_id=$1 AND user_id=$2', [id, user.id]);
    await history(client, mission, user, 'JOIN', null, {
      approvalStatus: status,
      type
    });
    return {
      joined: true,
      type,
      approvalStatus: status
    };
  });
}
export async function participantAction(id, user, targetId, action, body = {}) {
  requireUuid(targetId);
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    if (targetId !== user.id || !['LEAVE', 'CHARACTER'].includes(action)) requireManager(mission, user);
    if (['RUNNING', 'FINISHED', 'CANCELLED'].includes(mission.status)) fail(409, 'Não é possível alterar inscrições neste estado.');
    const {
      rows
    } = await client.query('SELECT * FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [id, targetId]);
    const entry = rows[0];
    if (!entry) {
      if (action === 'LEAVE') return {
        left: true
      };
      fail(404, 'Inscrição não encontrada.');
    }
    if (action === 'CHARACTER') {
      validateCharacter(mission, await character(client, body.characterId), targetId);
      await client.query('UPDATE mission_participants SET character_id=$3 WHERE mission_id=$1 AND user_id=$2', [id, targetId, body.characterId || null]);
    } else if (action === 'APPROVE') {
      if (entry.approval_status === 'APPROVED') return {
        approved: true
      };
      // Deadline closes new requests, not the resolution of already submitted ones.
      validateCharacter(mission, await character(client, entry.character_id), targetId);
      await promoteAndAlert(client, mission);
      const counts = await slotCounts(client, id);
      const type = counts.players < mission.max_players ? 'PLAYER' : counts.reserves < mission.max_reserves ? 'RESERVE' : null;
      if (!type) fail(409, 'Sem capacidade para aprovar esta inscrição.');
      await client.query("UPDATE mission_participants SET type=$3,approval_status='APPROVED',approved_at=clock_timestamp() WHERE mission_id=$1 AND user_id=$2", [id, targetId, type]);
      await notify(client, targetId, id, 'APPROVED', 'Sua inscrição foi aprovada.');
    } else if (['LEAVE', 'REJECT', 'REMOVE'].includes(action)) {
      await client.query('DELETE FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [id, targetId]);
      if (targetId !== user.id) await notify(client, targetId, id, 'REGISTRATION_REMOVED', 'Sua inscrição nesta missão foi removida.');
    } else fail(400, 'Ação de inscrição inválida.');
    await promoteAndAlert(client, mission);
    await history(client, mission, user, action, body.reason || null, {
      userId: targetId
    });
    return {
      ok: true,
      left: action === 'LEAVE'
    };
  });
}
export function parseOptionalDate(value, name) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, `${name} inválido.`);
  return new Date(value).toISOString();
}
export async function editMission(id, user, body) {
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    requireManager(mission, user);
    if (['FINISHED', 'CANCELLED'].includes(mission.status)) fail(409, 'Reabra a missão antes de editar.');
    if (body.status !== undefined) fail(400, 'Use uma ação de ciclo de vida para alterar o estado.');
    const updates = [];
    const values = [];
    const set = (column, value) => {
      values.push(value);
      updates.push(`${column}=$${values.length}`);
    };
    for (const field of ['title', 'description', 'reward', 'level']) {
      if (body[field] === undefined) continue;
      if (typeof body[field] !== 'string' || ['title', 'description'].includes(field) && !body[field].trim()) fail(400, `${field} inválido.`);
      set(field, body[field].trim());
    }
    const rulesChanged = ['minPlayers', 'maxPlayers', 'maxReserves', 'minLevel', 'maxLevel', 'approvalRequired'].some(k => body[k] !== undefined);
    if (rulesChanged) {
      const rules = validateMissionFields(body, mission);
      const counts = await slotCounts(client, id);
      if (rules.maxPlayers < counts.players || rules.maxReserves < counts.reserves) fail(409, 'Não reduza a capacidade abaixo das vagas aprovadas.');
      for (const [key, col] of Object.entries({
        minPlayers: 'min_players',
        maxPlayers: 'max_players',
        maxReserves: 'max_reserves',
        minLevel: 'min_level',
        maxLevel: 'max_level',
        approvalRequired: 'approval_required'
      })) set(col, rules[key]);
    }
    if (body.datetime !== undefined) set('datetime', parseOptionalDate(body.datetime, 'Agendamento'));
    if (body.registrationDeadline !== undefined) set('registration_deadline', parseOptionalDate(body.registrationDeadline, 'Prazo'));
    if (!updates.length) fail(400, 'Nenhum campo válido para alterar.');
    values.push(id);
    await client.query(`UPDATE missions SET ${updates.join(',')},updated_at=NOW() WHERE id=$${values.length}`, values);
    await history(client, mission, user, 'EDIT', body.reason || null, {
      before: {
        minLevel: mission.min_level,
        maxLevel: mission.max_level
      },
      changes: body
    });
    await promoteAndAlert(client, await lockedMission(client, id));
  });
}
async function closeActiveSession(client, mission, user, summary = null) {
  const {
    rows
  } = await client.query("UPDATE session_logs SET status='closed',closed_at=NOW(),closed_by=$2,summary=COALESCE($3,summary) WHERE mission_id=$1 AND status='open' AND deleted_at IS NULL RETURNING *", [mission.id, user.id, summary]);
  for (const session of rows) {
    await client.query(`INSERT INTO session_snapshots(session_id,player_id,actor_name,total_gold_delta,total_xp_delta,total_hp_delta,potions_used)
      SELECT $1,player_id,MAX(actor_name),COALESCE(SUM(delta) FILTER(WHERE resource_type='gold'),0),
      COALESCE(SUM(delta) FILTER(WHERE resource_type='xp'),0),COALESCE(SUM(delta) FILTER(WHERE resource_type='hp'),0),
      COALESCE(SUM(ABS(delta)) FILTER(WHERE resource_type='potion' AND delta<0),0)
      FROM resource_deltas WHERE session_id=$1 AND deleted_at IS NULL GROUP BY player_id
      ON CONFLICT(session_id,player_id) DO NOTHING`, [session.id]);
    await client.query('UPDATE session_attendance SET left_at=COALESCE(left_at,NOW()),last_seen_at=NOW() WHERE session_id=$1', [session.id]);
  }
  await client.query('UPDATE foundry_handshakes SET expires_at=NOW() WHERE mission_id=$1', [mission.id]);
  return rows[0] || null;
}
export async function transitionMission(id, user, action, body = {}) {
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    requireManager(mission, user);
    if (mission.kind === 'NOTICE') fail(400, 'Avisos não têm sessões ou inscrições.');
    if (action === 'PAUSE' && mission.status === 'PAUSED' || action === 'FINISH' && mission.status === 'FINISHED' && body.confirmed === true) return {
      session: null,
      reused: true
    };
    let session = null;
    if (action === 'START') {
      if (mission.status === 'RUNNING') {
        const active = await client.query("SELECT * FROM session_logs WHERE mission_id=$1 AND status='open' AND deleted_at IS NULL", [id]);
        if (!active.rows[0]) fail(409, 'Estado inconsistente: missão sem sessão ativa.');
        return {
          session: active.rows[0],
          reused: true
        };
      }
      if (!['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status)) fail(409, 'A missão não pode iniciar neste estado.');
      if (!mission.gm_id) fail(409, 'Designe um narrador que tenha aceitado a missão.');
      if (!isGM((await client.query('SELECT role FROM users WHERE id=$1', [mission.gm_id])).rows[0])) fail(409, 'O narrador designado não possui mais uma conta GM.');
      if (!mission.min_players) fail(409, 'Configure o mínimo de participantes desta missão legada.');
      await promoteAndAlert(client, mission);
      if ((await slotCounts(client, id)).players < mission.min_players) fail(409, 'Quantidade mínima de participantes não atingida.');
      let handshake;
      if (body.code) {
        const hs = await client.query('SELECT * FROM foundry_handshakes WHERE code=$1 FOR UPDATE', [String(body.code).trim().toUpperCase()]);
        handshake = hs.rows[0];
        if (!handshake || handshake.expires_at && new Date(handshake.expires_at) <= new Date() || handshake.mission_id && handshake.mission_id !== id) fail(400, 'Código inválido, expirado ou usado em outra missão.');
      }
      let arc = (await client.query("SELECT * FROM mission_arcs WHERE mission_id=$1 AND status='active' AND deleted_at IS NULL ORDER BY arc_number DESC LIMIT 1", [id])).rows[0];
      if (!arc) arc = (await client.query(`INSERT INTO mission_arcs(mission_id,title,arc_number,primary_gm_id)
        SELECT $1,$2,COALESCE(MAX(arc_number),0)+1,$3 FROM mission_arcs WHERE mission_id=$1 RETURNING *`, [id, mission.title, mission.gm_id])).rows[0];
      const players = (await client.query("SELECT user_id FROM mission_participants WHERE mission_id=$1 AND type='PLAYER' AND approval_status='APPROVED' ORDER BY joined_at,id", [id])).rows.map(p => p.user_id);
      session = (await client.query(`INSERT INTO session_logs(title,campaign,session_number,opened_by,primary_gm_id,narrator_ids,player_ids,arc_id,mission_id)
        SELECT $2,$3,COALESCE(MAX(session_number),0)+1,$4,$5,$6,$7,$8,$1 FROM session_logs WHERE mission_id=$1 RETURNING *`, [id, body.title?.trim() || mission.title, mission.title, user.id, mission.gm_id, [mission.gm_id], players, arc.id])).rows[0];
      if (handshake) await client.query('UPDATE foundry_handshakes SET session_id=$2,mission_id=$3,claimed_at=NOW(),claimed_by=$4,expires_at=NULL WHERE code=$1', [handshake.code, session.id, id, user.id]);
      await client.query("UPDATE missions SET status='RUNNING',registrations_open=FALSE,started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1", [id]);
    } else if (['OPEN_REGISTRATIONS', 'CLOSE_REGISTRATIONS'].includes(action)) {
      if (!['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status)) fail(409, 'Não é possível alterar inscrições neste estado.');
      const opening = action === 'OPEN_REGISTRATIONS';
      if (opening && mission.registration_deadline && new Date(mission.registration_deadline) <= new Date()) fail(409, 'Atualize o prazo antes de reabrir as inscrições.');
      await client.query("UPDATE missions SET registrations_open=$2,status=CASE WHEN status IN ('OPEN','CLOSED') THEN $3::mission_status ELSE status END,updated_at=NOW() WHERE id=$1", [id, opening, opening ? 'OPEN' : 'CLOSED']);
      if (opening) await promoteAndAlert(client, {
        ...mission,
        registrations_open: true,
        status: mission.status === 'PAUSED' ? 'PAUSED' : 'OPEN'
      });
    } else {
      const target = {
        PAUSE: 'PAUSED',
        FINISH: 'FINISHED',
        CANCEL: 'CANCELLED',
        REOPEN: 'PAUSED',
        REACTIVATE: mission.started_at ? 'PAUSED' : 'CLOSED'
      }[action];
      const allowed = {
        PAUSE: ['RUNNING'],
        FINISH: ['RUNNING', 'PAUSED'],
        CANCEL: ['OPEN', 'CLOSED', 'PAUSED'],
        REOPEN: ['FINISHED'],
        REACTIVATE: ['CANCELLED']
      }[action];
      if (!allowed?.includes(mission.status)) fail(409, 'Transição de estado inválida.');
      if (['FINISH', 'REOPEN', 'REACTIVATE'].includes(action) && body.confirmed !== true) fail(400, 'Confirmação explícita obrigatória.');
      if (['CANCEL', 'REOPEN', 'REACTIVATE'].includes(action) && !body.reason?.trim()) fail(400, 'Informe o motivo.');
      if (['PAUSE', 'FINISH'].includes(action)) session = await closeActiveSession(client, mission, user, body.summary);
      await client.query('UPDATE missions SET status=$2,registrations_open=FALSE,updated_at=NOW() WHERE id=$1', [id, target]);
      if (action === 'CANCEL') {
        const users = await client.query('SELECT user_id FROM mission_participants WHERE mission_id=$1', [id]);
        for (const row of users.rows) await notify(client, row.user_id, id, 'CANCELLED', `Missão cancelada: ${body.reason.trim()}`);
      }
    }
    await history(client, mission, user, action, body.reason || null, {
      from: mission.status,
      sessionId: session?.id || null
    });
    return {
      session
    };
  });
}
export async function gmRequest(id, user, body) {
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    if (mission.kind === 'NOTICE' || !['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status)) fail(409, 'Narrador não pode ser alterado neste estado.');
    const targetId = body.userId || user.id;
    requireUuid(targetId);
    const target = (await client.query('SELECT id,role FROM users WHERE id=$1', [targetId])).rows[0];
    if (!isGM(target)) fail(400, 'A candidatura ou convite exige uma conta GM do Nimrod.');
    if (body.kind === 'INVITE' && mission.creator_id !== user.id) fail(403, 'Somente o criador convida narradores.');
    if (body.kind !== 'INVITE' && (targetId !== user.id || body.kind !== 'APPLICATION')) fail(400, 'Candidatura inválida.');
    const request = await client.query(`INSERT INTO mission_gm_requests(mission_id,user_id,kind) VALUES($1,$2,$3)
      ON CONFLICT(mission_id,user_id,kind) WHERE status='PENDING' DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`, [id, targetId, body.kind]);
    await notify(client, body.kind === 'INVITE' ? targetId : mission.creator_id, id, 'GM_REQUEST', 'Há um convite ou candidatura de narrador para avaliar.');
    return request.rows[0];
  });
}
export async function resolveGmRequest(id, user, requestId, body) {
  requireUuid(requestId);
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    if (!['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status)) fail(409, 'Substitua o narrador antes do início ou durante PAUSED.');
    const entry = (await client.query('SELECT * FROM mission_gm_requests WHERE mission_id=$1 AND id=$2 FOR UPDATE', [id, requestId])).rows[0];
    if (!entry) fail(404, 'Convite ou candidatura não encontrado.');
    const allowed = entry.kind === 'INVITE' ? entry.user_id === user.id : mission.creator_id === user.id;
    if (!allowed) fail(403, 'Você não pode responder a esta solicitação.');
    if (entry.status !== 'PENDING') return entry;
    if (typeof body.accept !== 'boolean') fail(400, 'accept deve ser booleano.');
    if (body.accept) {
      const target = (await client.query('SELECT id,role FROM users WHERE id=$1', [entry.user_id])).rows[0];
      if (!isGM(target)) fail(409, 'A conta candidata não possui mais permissão GM.');
      await client.query('UPDATE missions SET gm_id=$2,updated_at=NOW() WHERE id=$1', [id, entry.user_id]);
      await client.query("UPDATE mission_arcs SET primary_gm_id=$2 WHERE mission_id=$1 AND status='active' AND deleted_at IS NULL", [id, entry.user_id]);
      await client.query("UPDATE mission_gm_requests SET status='SUPERSEDED',resolved_at=NOW() WHERE mission_id=$1 AND status='PENDING' AND id<>$2", [id, entry.id]);
    }
    const result = await client.query('UPDATE mission_gm_requests SET status=$2,resolved_at=NOW() WHERE id=$1 RETURNING *', [entry.id, body.accept ? 'ACCEPTED' : 'REJECTED']);
    await history(client, mission, user, body.accept ? 'GM_ASSIGNED' : 'GM_REJECTED', body.reason || null, {
      previousGmId: mission.gm_id,
      userId: entry.user_id
    });
    await notify(client, entry.user_id, id, 'GM_RESOLVED', body.accept ? 'Você é o narrador designado.' : 'A solicitação de narração foi rejeitada.');
    return result.rows[0];
  });
}
export async function vacancyAlert(id, user, enabled, emailEnabled = false) {
  if (emailEnabled && !emailAvailable()) fail(503, 'Transporte de e-mail não configurado. O alerta interno está disponível.');
  return transaction(async client => {
    const mission = await lockedMission(client, id);
    if (!enabled) {
      await client.query('DELETE FROM mission_vacancy_alerts WHERE mission_id=$1 AND user_id=$2', [id, user.id]);
      return {
        watching: false
      };
    }
    if (mission.kind === 'NOTICE' || !['OPEN', 'CLOSED', 'PAUSED'].includes(mission.status)) fail(409, 'Alertas indisponíveis neste estado.');
    await promoteAndAlert(client, mission);
    const counts = await slotCounts(client, id);
    if (counts.players < mission.max_players || counts.reserves < mission.max_reserves) fail(409, 'Já há uma vaga disponível para inscrição.');
    if ((await client.query('SELECT 1 FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [id, user.id])).rows.length) fail(409, 'Você já possui uma inscrição.');
    await client.query('INSERT INTO mission_vacancy_alerts(mission_id,user_id,email_enabled) VALUES($1,$2,$3) ON CONFLICT(mission_id,user_id) DO UPDATE SET email_enabled=EXCLUDED.email_enabled', [id, user.id, Boolean(emailEnabled)]);
    return {
      watching: true,
      emailAvailable: emailAvailable()
    };
  });
}
export async function missionHistory(id, user) {
  const mission = (await query('SELECT * FROM missions WHERE id=$1', [id])).rows[0];
  if (!mission) fail(404, 'Missão não encontrada.');
  requireManager(mission, user);
  return (await query('SELECT * FROM mission_history WHERE mission_id=$1 ORDER BY created_at,id', [id])).rows;
}

// The code attaches an already authorized session; it never assigns a narrator.
export async function linkMissionFoundrySession(sessionId, user, code) {
  requireUuid(sessionId);
  const original = (await query('SELECT mission_id FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [sessionId])).rows[0];
  if (!original?.mission_id) return null; // Keep standalone legacy session handling.
  return transaction(async client => {
    const mission = await lockedMission(client, original.mission_id);
    requireManager(mission, user);
    const session = (await client.query('SELECT * FROM session_logs WHERE id=$1 AND deleted_at IS NULL', [sessionId])).rows[0];
    if (session?.status !== 'open') fail(409, 'A sessão não está aberta.');
    if (typeof code !== 'string' || !code.trim()) fail(400, 'Código obrigatório.');
    const handshake = (await client.query('SELECT * FROM foundry_handshakes WHERE code=$1 FOR UPDATE', [code.trim().toUpperCase()])).rows[0];
    if (!handshake || handshake.expires_at && new Date(handshake.expires_at) <= new Date() || handshake.session_id && handshake.session_id !== session.id) fail(409, 'Código inválido, expirado ou já usado.');
    await client.query('UPDATE foundry_handshakes SET session_id=$2,mission_id=$3,claimed_at=COALESCE(claimed_at,NOW()),claimed_by=$4 WHERE code=$1', [handshake.code, session.id, mission.id, user.id]);
    await history(client, mission, user, 'FOUNDRY_LINKED', null, {
      sessionId: session.id,
      worldId: handshake.world_id
    });
    return {
      ok: true,
      sessionId: session.id,
      worldId: handshake.world_id
    };
  });
}
