import { query } from '../db/index.js';
import { isFoundryRequest } from '../lib/foundryAuth.js';
import { fail, requireUuid,validateRequestBody } from '../services/missionRules.js';
import { createIdentityProof, approveIdentityProof, redeemIdentityProof, foundryClient } from '../services/foundryIdentity.js';
import { transitionMission } from '../services/missionBoard.js';
import { attendanceList, confirmAttendance, recordConnection } from '../services/missionAttendance.js';
import { broadcast } from '../ws/broadcast.js';
import { emailAvailable } from '../services/notifier/email.js';
import { assertRateLimit } from '../middleware/rateLimit.js';
export async function missionIntegrationRoutes(fastify) {
  fastify.addHook('preValidation', async req => {
    if (req.params.id !== undefined) requireUuid(req.params.id);
    validateRequestBody(req.body);
  });
  fastify.get('/notifications', async req => ({
    items: (await query('SELECT id,mission_id,type,message,read_at,created_at FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id])).rows,
    emailAvailable: emailAvailable()
  }));
  fastify.patch('/notifications/:id', async req => {
    const result = await query('UPDATE user_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!result.rows[0]) fail(404, 'Notificação não encontrada.');
    return {
      read: true
    };
  });
  fastify.post('/foundry/identity/:id/approve', async req => approveIdentityProof(req.params.id, req.user));
  fastify.get('/foundry/identity/:id', async req => {
    const proof = (await query('SELECT world_id,foundry_user_id,requested_gm,expires_at FROM foundry_identity_proofs WHERE id=$1 AND consumed_at IS NULL AND expires_at>NOW()', [req.params.id])).rows[0];
    if (!proof) fail(410, 'Associação expirada ou indisponível.');
    return proof;
  });
  fastify.get('/foundry/identity-links', async req => (await query('SELECT world_id,foundry_user_id,verified_at FROM foundry_user_links WHERE user_id=$1', [req.user.id])).rows);
  fastify.delete('/foundry/identity-links/:worldId', async req => {
    await query('DELETE FROM foundry_user_links WHERE world_id=$1 AND user_id=$2', [req.params.worldId, req.user.id]);
    return {
      revoked: true
    };
  });
  fastify.post('/nimrod/identity/proofs', async (req, reply) => {
    if (!(await isFoundryRequest(req))) return reply.code(401).send({
      error: 'Invalid API key.'
    });
    if (!assertRateLimit(req, reply, 'foundry:identity', {
      limit: 20,
      windowMs: 60000
    })) return reply;
    return createIdentityProof(req.body || {});
  });
  fastify.post('/nimrod/identity/:id/redeem', async (req, reply) => {
    if (!assertRateLimit(req, reply, 'foundry:redeem', {
      limit: 60,
      windowMs: 60000
    })) return reply;
    return redeemIdentityProof(req.params.id, req.body?.secret);
  });
  fastify.get('/nimrod/missions', async req => {
    const {
      user
    } = await foundryClient(req);
    return (await query(`SELECT m.*,(m.creator_id=$1 OR m.gm_id=$1) AS "canManage",COALESCE((SELECT json_agg(json_build_object('userId',mp.user_id,'name',COALESCE(u.display_name,u.name),'type',mp.type,'approvalStatus',mp.approval_status))
      FROM mission_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.mission_id=m.id),'[]') AS participants,
      (SELECT id FROM session_logs WHERE mission_id=m.id AND status='open' AND deleted_at IS NULL LIMIT 1) AS active_session_id
      FROM missions m WHERE kind='MISSION' AND (gm_id=$1 OR creator_id=$1 OR EXISTS(SELECT 1 FROM mission_participants WHERE mission_id=m.id AND user_id=$1 AND approval_status='APPROVED'))
      ORDER BY m.created_at DESC LIMIT 100`, [user.id])).rows;
  });
  for (const [path, action] of Object.entries({
    start: 'START',
    pause: 'PAUSE',
    finish: 'FINISH'
  })) {
    fastify.post(`/nimrod/missions/:id/${path}`, async req => {
      const {
        user
      } = await foundryClient(req);
      const result = await transitionMission(req.params.id, user, action, req.body || {});
      const {
        getMissionWithCounts,
        serializeSessionSummary
      } = await import('./missions.js');
      const mission = await getMissionWithCounts(req.params.id, user.id);
      broadcast('MISSION_UPDATED', {
        id: mission.id
      });
      if (result.session) broadcast(action === 'START' ? 'SESSION_CREATED' : 'SESSION_CLOSED', serializeSessionSummary(result.session));
      return {
        ...result,
        mission
      };
    });
  }
  fastify.get('/nimrod/sessions/:id/attendance', async req => attendanceList(req.params.id, (await foundryClient(req)).user));
  fastify.post('/nimrod/sessions/:id/attendance', async req => {
    const {
      user
    } = await foundryClient(req);
    const attendance = await confirmAttendance(req.params.id, user, req.body?.userId || user.id, req.body?.confirmed, req.body?.reason);
    broadcast('SESSION_ATTENDANCE_UPDATED', {
      sessionId: req.params.id
    });
    return {
      attendance
    };
  });
  fastify.post('/nimrod/sessions/:id/connection', async req => {
    const {
      user
    } = await foundryClient(req);
    const result = await recordConnection(req.params.id, {
      userId: user.id,
      eventType: req.body?.eventType
    });
    if (result.persisted) broadcast('SESSION_CONNECTION_UPDATED', {
      sessionId: req.params.id
    });
    return result;
  });
  fastify.get('/sessions/:id/attendance', async req => attendanceList(req.params.id, req.user));
  fastify.post('/sessions/:id/attendance', async req => {
    const attendance = await confirmAttendance(req.params.id, req.user, req.body?.userId || req.user.id, req.body?.confirmed, req.body?.reason);
    broadcast('SESSION_ATTENDANCE_UPDATED', {
      sessionId: req.params.id
    });
    return {
      attendance
    };
  });
}
