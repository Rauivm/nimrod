import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';

vi.mock('../src/db/index.js', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
import { query, pool } from '../src/db/index.js';
import { ManaAccess } from '../src/services/manaAccess.js';
import { manaBridgeRoutes } from '../src/routes/mana.js';
import { ActivityPermissionService } from '../src/services/activityPermission.js';
import { sideQuestRoutes } from '../src/routes/sideQuests.js';

const user = { id: '11111111-1111-4111-8111-111111111111', role: 'PLAYER' };
const row = { user_id: user.id, owner_id: user.id, execution_mode: 'mana',
  participant_id: '22222222-2222-4222-8222-222222222222', participant_status: 'JOINED',
  active: true, retired: false, dead: false, status: 'WAITING',
  starts_at: new Date(Date.now() - 60000), ends_at: new Date(Date.now() + 3600000),
  character_id: '33333333-3333-4333-8333-333333333333', character_name: 'Thorin',
  activity_id: '44444444-4444-4444-8444-444444444444', display_name: 'Raui', title: 'Floresta' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MANA_BRIDGE_SECRET', 'local-test-secret-not-a-production-secret');
  vi.stubEnv('MANA_PUBLIC_URL', 'http://localhost:5184/');
});
afterEach(() => vi.unstubAllEnvs());

describe('Mana launch authorization', () => {
  it('launch route returns promptly using the existing synchronous auth guard', async () => {
    const app = Fastify();
    app.addHook('preHandler', async req => { req.user = user; });
    await app.register(sideQuestRoutes);
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });
    const res = await app.inject({ method: 'POST', url: `/sidequests/${row.activity_id}/launch`,
      payload: { character_id: row.character_id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain('#nimrod=');
    await app.close();
  });
  it('issues a two-minute opaque ticket without identity in the URL', async () => {
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });
    const result = await ManaAccess.launch(user, row.activity_id, row.character_id);
    const token = new URL(result.url).hash.slice(8);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.url).not.toContain(user.id);
    expect(query.mock.calls[1][1][0]).toBe(createHash('sha256').update(token).digest('hex'));
  });
  it.each([
    ['not enrolled', undefined], ['other owner', { ...row, owner_id: 'other' }],
    ['cancelled', { ...row, status: 'CANCELLED' }], ['dead', { ...row, dead: true }],
    ['retired', { ...row, retired: true }], ['inactive', { ...row, active: false }],
    ['not released yet', { ...row, starts_at: new Date(Date.now() + 60000) }],
    ['expired', { ...row, ends_at: new Date(Date.now() - 60000) }],
    ['legacy activity', { ...row, execution_mode: null }],
  ])('rejects %s', async (_, value) => {
    query.mockResolvedValue({ rows: value ? [value] : [] });
    await expect(ManaAccess.launch(user, row.activity_id, row.character_id)).rejects.toMatchObject({ statusCode: 403 });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('disables launch when integration has no secret', async () => {
    vi.stubEnv('MANA_BRIDGE_SECRET', '');
    await expect(ManaAccess.launch(user, row.activity_id, row.character_id)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('requires HTTPS for production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(ManaAccess.launch(user, row.activity_id, row.character_id)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('rejects used or expired tickets, rolling back and releasing the client', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    pool.connect.mockResolvedValue(client);
    await expect(ManaAccess.redeem('a'.repeat(64))).rejects.toMatchObject({ statusCode: 401 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
  it('persists the authorized identity in the existing activity audit transaction', async () => {
    const ticket = { id: '55555555-5555-4555-8555-555555555555', user_id: user.id, participant_id: row.participant_id };
    const client = { query: vi.fn()
      .mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({}), release: vi.fn() };
    pool.connect.mockResolvedValue(client);
    const identity = await ManaAccess.redeem('a'.repeat(64));
    expect(identity.character_name).toBe('Thorin');
    expect(identity).not.toHaveProperty('email');
    expect(client.query.mock.calls[4][0]).toContain('activity_logs');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
  it('revokes an existing game grant after the activity closes', async () => {
    query.mockResolvedValueOnce({ rows: [{ participant_id: row.participant_id, user_id: user.id }] })
      .mockResolvedValueOnce({ rows: [{ ...row, status: 'CANCELLED' }] });
    await expect(ManaAccess.authorize('55555555-5555-4555-8555-555555555555')).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(['PLAYER', 'GM', 'GM_PRINCIPAL'])('permits %s to enroll their own eligible character', role => {
    expect(ActivityPermissionService.canJoin({ ...user, role }, { user_id: user.id, active: true },
      { status: 'WAITING', starts_at: row.starts_at, ends_at: row.ends_at, max_participants: 0 }, 0).allowed).toBe(true);
  });
  it('authenticates server endpoints separately from human login', async () => {
    const app = Fastify();
    await app.register(manaBridgeRoutes);
    const res = await app.inject({ method: 'POST', url: '/mana/redeem', payload: { token: 'a'.repeat(64) } });
    expect(res.statusCode).toBe(401);
    expect(pool.connect).not.toHaveBeenCalled();
    await app.close();
  });
});
