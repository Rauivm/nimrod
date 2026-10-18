import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../src/db/index.js', () => ({ query: vi.fn(), pool: {} }));
vi.mock('../src/ws/broadcast.js', () => ({ broadcast: vi.fn() }));
import { query } from '../src/db/index.js';
import { profileRoutes } from '../src/routes/profile.js';

const owner = '22222222-2222-4222-8222-222222222222';
let app;
beforeEach(async () => {
  vi.resetAllMocks();
  app = Fastify({ logger: false });
  app.addHook('preHandler', async req => { req.user = { id: owner, role: 'PLAYER' }; });
  await app.register(profileRoutes);
});
afterEach(async () => { await app.close(); });

describe('Existing authenticated character roster contract', () => {
  it('uses the authenticated owner even if a different user is supplied in query parameters', async () => {
    query.mockResolvedValue({ rows: [] });
    const response = await app.inject('/me/characters?userId=someone-else');
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual([]);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([owner]);
    expect(sql).toMatch(/WHERE user_id = \$1 AND active = TRUE AND retired = FALSE/);
    expect(sql).not.toMatch(/UPDATE|INSERT|DELETE/);
  });
  it('exposes real identity, class, level, portraits and sync metadata without adding equipment', async () => {
    query.mockResolvedValue({ rows: [{ id: '33333333-3333-4333-8333-333333333333', user_id: owner,
      foundry_actor_id: 'syntheticActor', name: 'Synthetic character', level: 8, classe: 'Druida', race: 'Elfo',
      active: true, retired: false, dead: false, token_img: 'worlds/test/token.webp', portrait_img: 'worlds/test/portrait.webp', last_synced_at: '2026-10-17T12:00:00Z' }] });
    const response = await app.inject('/me/characters');
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ userId: owner, foundryActorId: 'syntheticActor', name: 'Synthetic character',
      level: 8, classe: 'Druida', race: 'Elfo', tokenImg: 'worlds/test/token.webp', portraitImg: 'worlds/test/portrait.webp',
      lastSyncedAt: '2026-10-17T12:00:00Z', active: true, retired: false, dead: false });
    expect(response.json()[0]).not.toHaveProperty('equipment');
  });
  it('preserves the existing dead-state field so consumers can filter without changing the API contract', async () => {
    query.mockResolvedValue({ rows: [{ id: 'synthetic', user_id: owner, name: 'Synthetic', active: true, retired: false, dead: true }] });
    expect((await app.inject('/me/characters')).json()[0].dead).toBe(true);
  });
});
