import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';

vi.mock('../src/db/index.js', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
import { query, pool } from '../src/db/index.js';
import { ManaAccess } from '../src/services/manaAccess.js';
import { manaPlayerRoutes } from '../src/routes/mana.js';
import { build } from '../src/app.js';

const user = { id: '11111111-1111-4111-8111-111111111111' };
const character = { character_id: '33333333-3333-4333-8333-333333333333', user_id: user.id,
  owner_id: user.id, character_name: 'Maegor', display_name: 'Tharley', active: true, retired: false, dead: false };
const ticket = { id: '55555555-5555-4555-8555-555555555555', user_id: user.id,
  character_id: character.character_id, scope: 'lobby', session_expires_at: new Date(Date.now() + 3600000) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MANA_BRIDGE_SECRET', 'dedicated-local-test-secret-at-least-32');
  vi.stubEnv('MANA_PUBLIC_URL', 'http://localhost:5184/');
});
afterEach(() => vi.unstubAllEnvs());

describe('Mana lobby identity', () => {
  it('authenticates server calls independently from the global human hook', async () => {
    vi.stubEnv('DEV_USER_EMAIL', '');
    const app = await build({ mockDb: { query: vi.fn() } });
    query.mockResolvedValueOnce({ rows: [ticket] }).mockResolvedValueOnce({ rows: [character] });
    const result = await app.inject({ method: 'POST', url: '/mana/authorize',
      headers: { authorization: `Bearer ${process.env.MANA_BRIDGE_SECRET}` }, payload: { grant_id: ticket.id } });
    expect(result.statusCode).toBe(200);
    expect(result.json().character_name).toBe('Maegor');
    const denied = await app.inject({ method: 'POST', url: '/mana/authorize', payload: { grant_id: ticket.id } });
    expect(denied.statusCode).toBe(401);
    const human = await app.inject({ method: 'POST', url: '/mana/launch',
      headers: { authorization: `Bearer ${process.env.MANA_BRIDGE_SECRET}` }, payload: { character_id: character.character_id } });
    expect(human.statusCode).toBe(401);
    await app.close();
  });
  it('launches an owned character without any activity or enrollment', async () => {
    query.mockResolvedValueOnce({ rows: [character] }).mockResolvedValueOnce({ rows: [] });
    const result = await ManaAccess.launchLobby(user, character.character_id);
    const token = new URL(result.url).hash.slice(8);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.characterName).toBe('Maegor');
    expect(query.mock.calls[0][0]).not.toContain('activity_participants');
    expect(query.mock.calls[1][1]).toEqual([createHash('sha256').update(token).digest('hex'), user.id, character.character_id]);
  });
  it.each([
    ['missing', null], ['foreign', { ...character, owner_id: 'other' }],
    ['inactive', { ...character, active: false }], ['retired', { ...character, retired: true }],
    ['dead', { ...character, dead: true }],
  ])('rejects %s characters', async (_, row) => {
    query.mockResolvedValue({ rows: row ? [row] : [] });
    await expect(ManaAccess.launchLobby(user, character.character_id)).rejects.toMatchObject({ statusCode: 403 });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('resolves identity and saves the historical snapshot atomically on redemption', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [character] }).mockResolvedValue({}), release: vi.fn() };
    pool.connect.mockResolvedValue(client);
    const result = await ManaAccess.redeem('a'.repeat(64));
    expect(result).toMatchObject({ scope: 'lobby', character_name: 'Maegor', display_name: 'Tharley' });
    expect(result).not.toHaveProperty('email');
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[3][0]).toContain('identity_snapshot');
    expect(client.query.mock.calls[4][0]).toContain('mana.lobby.authorized');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
  it('rechecks the current owner before consuming a ticket', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [{ ...character, owner_id: 'other' }] }), release: vi.fn() };
    pool.connect.mockResolvedValue(client);
    await expect(ManaAccess.redeem('a'.repeat(64))).rejects.toMatchObject({ statusCode: 403 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });
  it('refreshes the display name without changing the stable character identifier', async () => {
    query.mockResolvedValueOnce({ rows: [ticket] }).mockResolvedValueOnce({ rows: [{ ...character, character_name: 'Maegor Novo' }] });
    expect(await ManaAccess.authorize(ticket.id)).toMatchObject({ character_id: character.character_id, character_name: 'Maegor Novo' });
  });
  it('expires lobby sessions independently of the launch ticket', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...ticket, session_expires_at: new Date(Date.now() - 1000) }] })
      .mockResolvedValueOnce({ rows: [character] });
    await expect(ManaAccess.authorize(ticket.id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('requires Nimrod authentication and refuses client-supplied user identity', async () => {
    const app = Fastify();
    await app.register(manaPlayerRoutes);
    const missing = await app.inject({ method: 'POST', url: '/mana/launch', payload: { character_id: character.character_id } });
    expect(missing.statusCode).toBe(401);
    const forged = await app.inject({ method: 'POST', url: '/mana/launch', payload: { character_id: character.character_id, user_id: user.id } });
    // AJV strips unknown properties; authentication still cannot be supplied by body.
    expect(forged.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});
