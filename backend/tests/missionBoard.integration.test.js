import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

// Opt in only to the disposable DB; never load the developer's .env.
const connection = process.env.MISSION_TEST_DATABASE_URL;
const enabled = Boolean(connection);
if (enabled) {
  const url = new URL(connection);
  if (url.hostname !== '127.0.0.1' || url.port !== '55438' || url.pathname !== '/mission_audit_test') throw new Error('Unsafe mission test database');
  process.env.DATABASE_URL = connection;
  process.env.FOUNDRY_JWT_SECRET = 'mission-audit-synthetic-secret-only';
  process.env.FOUNDRY_API_KEY = 'mission-audit-synthetic-key-only';
  process.env.DISCORD_WEBHOOK_URL = '';
}
describe.runIf(enabled)('Mission board — real routes and PostgreSQL transactions', () => {
  let db, board, attendance, app, gm, creator, players;
  const request = (user, method, url, payload) => app.inject({
    method,
    url,
    payload,
    headers: {
      'x-test-user': user.id
    }
  });
  beforeAll(async () => {
    db = await import('../src/db/index.js');
    await db.runMigrations();
    board = await import('../src/services/missionBoard.js');
    attendance = await import('../src/services/missionAttendance.js');
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => reply.code(err.statusCode || 500).send({
      error: err.message
    }));
    app.addHook('preHandler', async req => {
      req.user = (await db.query('SELECT * FROM users WHERE id=$1', [req.headers['x-test-user']])).rows[0];
    });
    await app.register((await import('../src/routes/missions.js')).missionRoutes);
    await app.register((await import('../src/routes/missionIntegration.js')).missionIntegrationRoutes);
    await app.register((await import('../src/routes/sessions.js')).sessionRoutes);
    await app.register((await import('../src/routes/sessionEvents.js')).sessionEventRoutes);
    await app.ready();
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.pool.end();
  });
  beforeEach(async () => {
    creator = await user('PLAYER');
    gm = await user('GM');
    players = await Promise.all(Array.from({
      length: 8
    }, () => user('PLAYER')));
  });
  async function user(role) {
    const id = randomUUID();
    return (await db.query('INSERT INTO users(id,email,name,display_name,role) VALUES($1,$2,$3,$3,$4) RETURNING *', [id, `${id}@example.test`, 'Synthetic user', role])).rows[0];
  }
  async function mission(overrides = {}) {
    const res = await request(creator, 'POST', '/missions', {
      title: 'Audit mission',
      description: 'Synthetic mission',
      minPlayers: 1,
      minLevel: 1,
      maxLevel: 10,
      maxPlayers: 1,
      maxReserves: 2,
      ...overrides
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }
  async function assign(m, user = gm) {
    const entry = await board.gmRequest(m.id, creator, {
      userId: user.id,
      kind: 'INVITE'
    });
    await board.resolveGmRequest(m.id, user, entry.id, {
      accept: true
    });
  }
  it('creates for PLAYER without date, narrator or implicit enrollment; defaults two reserves', async () => {
    const m = await mission();
    expect(m.gm_id).toBeNull();
    expect(m.datetime).toBeNull();
    expect(m.max_reserves).toBe(2);
    expect(Number(m.player_count)).toBe(0);
  });
  it('last slots are not duplicated under concurrent requests; retries are idempotent', async () => {
    const m = await mission({
      maxReserves: 0
    });
    const results = await Promise.all(players.map(p => request(p, 'POST', `/missions/${m.id}/join`, {})));
    expect(results.filter(r => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter(r => r.statusCode === 409)).toHaveLength(7);
    const winner = players[results.findIndex(r => r.statusCode === 200)];
    expect((await request(winner, 'POST', `/missions/${m.id}/join`, {})).statusCode).toBe(200);
    expect((await board.slotCounts(db.pool, m.id)).players).toBe(1);
  });
  it('manual requests occupy no slot and approval rejects full capacity', async () => {
    const m = await mission({
      approvalRequired: true,
      maxReserves: 0
    });
    await Promise.all(players.slice(0, 2).map(p => board.joinMission(m.id, p, {})));
    expect((await board.slotCounts(db.pool, m.id)).players).toBe(0);
    await board.participantAction(m.id, creator, players[0].id, 'APPROVE');
    await expect(board.participantAction(m.id, creator, players[1].id, 'APPROVE')).rejects.toMatchObject({
      statusCode: 409
    });
  });
  it('promotes FIFO after deadline/closure without rechecking changed levels; alerts after promotion', async () => {
    const m = await mission();
    for (const p of players.slice(0, 3)) await board.joinMission(m.id, p, {});
    await board.vacancyAlert(m.id, players[3], true);
    await board.participantAction(m.id, players[0], players[0].id, 'LEAVE');
    const p = (await db.query('SELECT type FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [m.id, players[1].id])).rows[0];
    expect(p.type).toBe('PLAYER');
    expect((await db.query("SELECT 1 FROM user_notifications WHERE user_id=$1 AND type='VACANCY'", [players[3].id])).rows.length).toBe(1);
    await board.editMission(m.id, creator, {
      minLevel: 5,
      maxLevel: 10,
      registrationDeadline: '2000-01-01T00:00:00Z'
    });
    await board.transitionMission(m.id, creator, 'CLOSE_REGISTRATIONS');
    await board.participantAction(m.id, players[1], players[1].id, 'LEAVE');
    expect((await db.query('SELECT type FROM mission_participants WHERE mission_id=$1 AND user_id=$2', [m.id, players[2].id])).rows[0].type).toBe('PLAYER');
  });
  it('requires owned compatible character at min level four; allows later optional selection', async () => {
    const m = await mission({
      minLevel: 4
    });
    await expect(board.joinMission(m.id, players[0], {})).rejects.toMatchObject({
      statusCode: 400
    });
    const pc = (await db.query('INSERT INTO player_characters(user_id,name,level) VALUES($1,$2,4) RETURNING *', [players[0].id, 'Synthetic actor'])).rows[0];
    await expect(board.joinMission(m.id, players[1], {
      characterId: pc.id
    })).rejects.toMatchObject({
      statusCode: 400
    });
    await board.joinMission(m.id, players[0], {
      characterId: pc.id
    });
    const optional = await mission();
    await board.joinMission(optional.id, players[0], {});
    await board.participantAction(optional.id, players[0], players[0].id, 'CHARACTER', {
      characterId: pc.id
    });
  });
  it('only associated users administer; GM invitation requires acceptance', async () => {
    const m = await mission();
    const stranger = await user('GM');
    await expect(board.editMission(m.id, stranger, {
      title: 'Denied'
    })).rejects.toMatchObject({
      statusCode: 403
    });
    await expect(board.transitionMission(m.id, creator, 'START')).rejects.toMatchObject({
      statusCode: 409
    });
    await assign(m);
    expect((await db.query('SELECT gm_id FROM missions WHERE id=$1', [m.id])).rows[0].gm_id).toBe(gm.id);
    await expect(board.gmRequest(m.id, players[0], {
      kind: 'APPLICATION'
    })).rejects.toMatchObject({
      statusCode: 400
    });
  });
  it('site and Foundry simultaneous start reuse one session, pause/resume keep identities and history', async () => {
    const m = await mission();
    await assign(m);
    await board.joinMission(m.id, players[0], {});
    const results = await Promise.all([board.transitionMission(m.id, creator, 'START'), board.transitionMission(m.id, gm, 'START')]);
    expect(results[0].session.id).toBe(results[1].session.id);
    await expect(board.joinMission(m.id, players[1], {})).rejects.toMatchObject({
      statusCode: 409
    });
    await expect(board.transitionMission(m.id, creator, 'CANCEL', {
      reason: 'x'
    })).rejects.toMatchObject({
      statusCode: 409
    });
    const close = await request(creator, 'POST', `/sessions/${results[0].session.id}/close`, {});
    expect(close.statusCode, close.body).toBe(200);
    expect((await db.query('SELECT status FROM missions WHERE id=$1', [m.id])).rows[0].status).toBe('PAUSED');
    const replacement = await user('GM');
    await assign(m, replacement);
    await expect(board.transitionMission(m.id, gm, 'START')).rejects.toMatchObject({
      statusCode: 403
    });
    const next = await board.transitionMission(m.id, replacement, 'START');
    expect(next.session.id).not.toBe(results[0].session.id);
    expect(next.session.session_number).toBe(2);
    await expect(board.transitionMission(m.id, creator, 'FINISH', {})).rejects.toMatchObject({
      statusCode: 400
    });
    await board.transitionMission(m.id, creator, 'FINISH', {
      confirmed: true
    });
    await board.transitionMission(m.id, creator, 'REOPEN', {
      confirmed: true,
      reason: 'Continue'
    });
    expect((await db.query('SELECT COUNT(*)::int AS n FROM session_logs WHERE mission_id=$1', [m.id])).rows[0].n).toBe(2);
  });
  it('connection/reconnection does not confirm; duplicate confirmations have one audit event', async () => {
    const m = await mission();
    await assign(m);
    await board.joinMission(m.id, players[0], {});
    const {
      session
    } = await board.transitionMission(m.id, creator, 'START');
    await attendance.recordConnection(session.id, {
      userId: players[0].id,
      eventType: 'enter'
    });
    let rows = await attendance.attendanceList(session.id, players[0]);
    expect(rows[0].confirmed_at).toBeNull();
    expect(rows[0].connected).toBe(true);
    await Promise.all([attendance.confirmAttendance(session.id, players[0], players[0].id, true), attendance.confirmAttendance(session.id, players[0], players[0].id, true)]);
    await attendance.recordConnection(session.id, {
      userId: players[0].id,
      eventType: 'leave'
    });
    await attendance.recordConnection(session.id, {
      userId: players[0].id,
      eventType: 'reconnect'
    });
    rows = await attendance.attendanceList(session.id, players[0]);
    expect(rows[0].confirmed_at).not.toBeNull();
    expect((await db.query("SELECT COUNT(*)::int AS n FROM session_events WHERE session_id=$1 AND event_type='ATTENDANCE_CONFIRMED'", [session.id])).rows[0].n).toBe(1);
    await expect(attendance.confirmAttendance(session.id, players[1], players[0].id, true)).rejects.toMatchObject({
      statusCode: 403
    });
    await attendance.confirmAttendance(session.id, gm, players[0].id, false, 'Correction');
  });
  it('cancel/reactivate preserves participants, notifications and controlled state', async () => {
    const m = await mission();
    await board.joinMission(m.id, players[0], {});
    await expect(board.transitionMission(m.id, creator, 'CANCEL', {})).rejects.toMatchObject({
      statusCode: 400
    });
    await board.transitionMission(m.id, creator, 'CANCEL', {
      reason: 'Schedule conflict'
    });
    await board.transitionMission(m.id, creator, 'REACTIVATE', {
      reason: 'Resolved',
      confirmed: true
    });
    expect((await board.slotCounts(db.pool, m.id)).players).toBe(1);
    expect((await db.query("SELECT 1 FROM user_notifications WHERE mission_id=$1 AND type='CANCELLED'", [m.id])).rows.length).toBe(1);
  });
  it('Foundry identity requires authenticated approval and a one-use secret; code alone grants nothing', async () => {
    const identity = await import('../src/services/foundryIdentity.js');
    const proof = await identity.createIdentityProof({
      worldId: randomUUID(),
      foundryUserId: 'foundry-gm',
      isGM: true
    });
    expect(await identity.redeemIdentityProof(proof.proofId, proof.secret)).toEqual({
      pending: true
    });
    await expect(identity.approveIdentityProof(proof.proofId, players[0])).rejects.toMatchObject({
      statusCode: 403
    });
    await identity.approveIdentityProof(proof.proofId, gm);
    await expect(identity.redeemIdentityProof(proof.proofId, '0'.repeat(64))).rejects.toMatchObject({
      statusCode: 401
    });
    const result = await identity.redeemIdentityProof(proof.proofId, proof.secret);
    await expect(identity.redeemIdentityProof(proof.proofId, proof.secret)).rejects.toMatchObject({
      statusCode: 410
    });
    const context = await identity.foundryClient({
      headers: {
        authorization: `Bearer ${result.token}`
      }
    });
    expect(context.user.id).toBe(gm.id);
    const m = await mission();
    await assign(m);
    await board.joinMission(m.id, players[0], {});
    const [web, foundry] = await Promise.all([request(creator, 'POST', `/missions/${m.id}/start`, {}), app.inject({
      method: 'POST',
      url: `/nimrod/missions/${m.id}/start`,
      payload: {},
      headers: {
        authorization: `Bearer ${result.token}`
      }
    })]);
    expect(web.statusCode, web.body).toBe(200);
    expect(foundry.statusCode, foundry.body).toBe(200);
    expect(web.json().session.id).toBe(foundry.json().session.id);
    const denied = await app.inject({
      method: 'POST',
      url: `/nimrod/missions/${m.id}/start`,
      payload: {
        code: 'ANYCODE'
      }
    });
    expect(denied.statusCode).toBe(401);
    await db.query('DELETE FROM foundry_user_links WHERE world_id=$1', [result.worldId]);
    await expect(identity.foundryClient({
      headers: {
        authorization: `Bearer ${result.token}`
      }
    })).rejects.toMatchObject({
      statusCode: 401
    });
  });
  it('reopening and cancellation do not erase roster; late alerts do not reserve a seat', async () => {
    const m = await mission({
      maxReserves: 0
    });
    await board.joinMission(m.id, players[0], {});
    await board.vacancyAlert(m.id, players[1], true);
    await board.vacancyAlert(m.id, players[1], false);
    await board.vacancyAlert(m.id, players[2], true);
    await board.transitionMission(m.id, creator, 'CLOSE_REGISTRATIONS');
    await board.participantAction(m.id, players[0], players[0].id, 'LEAVE');
    expect((await board.slotCounts(db.pool, m.id)).players).toBe(0);
    expect((await db.query("SELECT user_id FROM user_notifications WHERE mission_id=$1 AND type='VACANCY'", [m.id])).rows.map(r => r.user_id)).toEqual([players[2].id]);
    await board.transitionMission(m.id, creator, 'OPEN_REGISTRATIONS');
    await board.joinMission(m.id, players[3], {});
  });
  it('unconfigured email is explicit and internal inbox remains private and persistent', async () => {
    const m = await mission({
      maxReserves: 0
    });
    await board.joinMission(m.id, players[0], {});
    await expect(board.vacancyAlert(m.id, players[1], true, true)).rejects.toMatchObject({
      statusCode: 503
    });
    await board.vacancyAlert(m.id, players[1], true, false);
    await board.participantAction(m.id, players[0], players[0].id, 'LEAVE');
    const mine = await request(players[1], 'GET', '/notifications');
    expect(mine.json().items.length).toBe(1);
    expect((await request(players[2], 'GET', '/notifications')).json().items.length).toBe(0);
    expect((await request(players[2], 'PATCH', `/notifications/${mine.json().items[0].id}`, {})).statusCode).toBe(404);
    expect((await request(players[1], 'PATCH', `/notifications/${mine.json().items[0].id}`, {})).statusCode).toBe(200);
  });
  it('ratings never inflate counts and input is validated on the real API', async () => {
    const m = await mission();
    for (const p of players.slice(0, 3)) await board.joinMission(m.id, p, {});
    await db.query('INSERT INTO mission_ratings(mission_id,user_id,stars) VALUES($1,$2,3),($1,$3,5)', [m.id, players[0].id, players[1].id]);
    const item = (await request(creator, 'GET', `/missions/${m.id}`)).json();
    expect(Number(item.player_count)).toBe(1);
    expect(Number(item.reserve_count)).toBe(2);
    expect(Number(item.avg_rating)).toBe(4);
    expect((await request(creator, 'POST', '/missions', {
      title: 123,
      description: 'bad'
    })).statusCode).toBe(400);
    expect((await request(creator, 'PATCH', `/missions/${m.id}`, {
      maxPlayers: 0
    })).statusCode).toBe(400);
    expect((await request(players[0], 'POST', '/missions/not-a-uuid/join', {})).statusCode).toBe(400);
  });
  it('does not identify a heartbeat by visible name or forged payload IDs',async()=>{
    const m=await mission();await assign(m);await board.joinMission(m.id,players[0],{});
    const {session}=await board.transitionMission(m.id,creator,'START');
    const response=await app.inject({method:'POST',url:`/sessions/${session.id}/session-events`,headers:{'x-nimrod-key':'mission-audit-synthetic-key-only'},payload:{
      eventType:'PLAYER_HEARTBEAT',foundryName:players[0].display_name,
      payload:{user_id:players[0].id,display_name:players[0].display_name,is_gm:true}
    }});
    expect(response.statusCode,response.body).toBe(201);expect(response.json().playerId).toBeNull();expect(response.json().payload.user_id).toBeUndefined();expect(response.json().payload.is_gm).toBeUndefined();
    expect((await db.query('SELECT COUNT(*)::int AS n FROM session_attendance WHERE session_id=$1',[session.id])).rows[0].n).toBe(0);
  });
  it('keeps notices and linked polls compatible, and disallows forced enrollment by legacy invite',async()=>{
    const notice=await request(creator,'POST','/missions',{kind:'NOTICE',title:'Synthetic notice',description:'Keep existing notice',pollQuestion:'Synthetic question?',pollOptions:['Yes','No']});
    expect(notice.statusCode,notice.body).toBe(201);expect(notice.json().kind).toBe('NOTICE');expect(notice.json().datetime).toBeNull();expect(notice.json().poll.options.length).toBe(2);
    const m=await mission();
    const legacy=await request(creator,'POST',`/missions/${m.id}/invite`,{userId:gm.id});expect(legacy.statusCode).toBe(409);
    const invite=await request(creator,'POST',`/missions/${m.id}/invite`,{userId:gm.id,kind:'GM'});expect(invite.statusCode,invite.body).toBe(200);
    expect((await board.slotCounts(db.pool,m.id)).players).toBe(0);
  });
  it('opens registrations during PAUSED while preserving past session roster', async () => {
    const m = await mission({
      maxPlayers: 2
    });
    await assign(m);
    await board.joinMission(m.id, players[0], {});
    const first = await board.transitionMission(m.id, creator, 'START');
    await board.transitionMission(m.id, creator, 'PAUSE');
    await board.transitionMission(m.id, gm, 'OPEN_REGISTRATIONS');
    await board.joinMission(m.id, players[1], {});
    expect((await db.query('SELECT status,registrations_open FROM missions WHERE id=$1', [m.id])).rows[0]).toEqual({
      status: 'PAUSED',
      registrations_open: true
    });
    const second = await board.transitionMission(m.id, gm, 'START');
    expect(first.session.player_ids).toEqual([players[0].id]);
    expect(second.session.player_ids).toEqual([players[0].id, players[1].id]);
  });
  it('fallback code links only an authorized session and never grants administration', async () => {
    const m = await mission();
    await assign(m);
    await board.joinMission(m.id, players[0], {});
    const {
      session
    } = await board.transitionMission(m.id, creator, 'START');
    const code = randomUUID().slice(0, 7).toUpperCase();
    await db.query('INSERT INTO foundry_handshakes(code,world_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'10 minutes\')', [code, 'synthetic-world']);
    await expect(board.linkMissionFoundrySession(session.id, players[1], code)).rejects.toMatchObject({
      statusCode: 403
    });
    const linked = await request(creator, 'POST', `/sessions/${session.id}/link-foundry`, {
      code
    });
    expect(linked.statusCode, linked.body).toBe(200);
    expect((await db.query('SELECT gm_id FROM missions WHERE id=$1', [m.id])).rows[0].gm_id).toBe(gm.id);
    const second = await mission();
    await assign(second);
    await board.joinMission(second.id, players[0], {});
    await expect(board.transitionMission(second.id, creator, 'START', {
      code
    })).rejects.toMatchObject({
      statusCode: 400
    });
    expect((await db.query('SELECT COUNT(*)::int AS n FROM session_logs WHERE mission_id=$1', [second.id])).rows[0].n).toBe(0);
  });
  it('upgrades legacy rows without inventing narrator or levels; refuses duplicate open sessions', async () => {
    const client = await db.pool.connect();
    try {
      const schema = `migration_audit_${randomUUID().replaceAll('-', '')}`;
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      const directory = new URL('../migrations/', import.meta.url);
      const files = (await readdir(directory)).filter(f => f.endsWith('.sql') && Number(f.slice(0, 3)) < 34).sort();
      for (const file of files) await client.query(await readFile(new URL(file, directory), 'utf8'));
      const creatorId = randomUUID(),
        gmId = randomUUID(),
        missionId = randomUUID();
      await client.query("INSERT INTO users(id,email,name,display_name,role) VALUES($1,'creator@example.test','Creator','Creator','PLAYER'),($2,'gm@example.test','GM','GM','GM')", [creatorId, gmId]);
      await client.query("INSERT INTO missions(id,creator_id,title,description,datetime,level) VALUES($1,$2,'Legacy','Preserve',NOW(),'Veteranos')", [missionId, creatorId]);
      await client.query('INSERT INTO mission_participants(mission_id,user_id) VALUES($1,$2)', [missionId, creatorId]);
      const arc = (await client.query("INSERT INTO mission_arcs(mission_id,title,primary_gm_id) VALUES($1,'Legacy arc',$2) RETURNING id", [missionId, gmId])).rows[0];
      await client.query("INSERT INTO session_logs(title,opened_by,primary_gm_id,arc_id) VALUES('Legacy session',$1,$1,$2)", [gmId, arc.id]);
      await client.query(await readFile(new URL('034_mission_lifecycle_states.sql', directory), 'utf8'));
      const migration = await readFile(new URL('035_mission_board.sql', directory), 'utf8');
      await client.query(migration);
      const row = (await client.query('SELECT * FROM missions WHERE id=$1', [missionId])).rows[0];
      expect(row.gm_id).toBe(gmId);
      expect(row.min_level).toBeNull();
      expect(row.level).toBe('Veteranos');
      expect((await client.query('SELECT approval_status FROM mission_participants')).rows[0].approval_status).toBe('APPROVED');
      expect((await client.query('SELECT mission_id FROM session_logs')).rows[0].mission_id).toBe(missionId);
      await expect(client.query("INSERT INTO session_logs(title,opened_by,primary_gm_id,mission_id) VALUES('Duplicate',$1,$1,$2)", [gmId, missionId])).rejects.toMatchObject({
        code: '23505'
      });
      await client.query(migration); // migration itself remains repeatable
      await client.query('DROP INDEX uq_mission_open_session');
      await client.query("INSERT INTO session_logs(title,opened_by,primary_gm_id,mission_id) VALUES('Legacy duplicate',$1,$1,$2)", [gmId, missionId]);
      await expect(client.query(migration)).rejects.toThrow(/Multiple open sessions/);
      await client.query('ROLLBACK');
      expect((await client.query('SELECT COUNT(*)::int AS n FROM session_logs')).rows[0].n).toBe(2);
    } finally {
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      client.release();
    }
  });
});
