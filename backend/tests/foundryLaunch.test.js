import { describe, it, expect, beforeEach } from 'vitest';
import { build } from '../src/app.js';

const MOCK_USER_PLAYER = { id: 'u1', email: 'player@test.com', role: 'PLAYER', name: 'Player One' };
const MOCK_USER_GM     = { id: 'u2', email: 'gm@test.com',     role: 'GM',     name: 'Game Master' };

describe('GET /foundry/launch', () => {
  it('returns 200 with a url containing ?t= when mapping exists', async () => {
    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb: {
        query: async () => ({
          rows:     [{ role: 'PLAYER', world: 'main', actor_name: 'Okaj' }],
          rowCount: 1,
        }),
      },
    });

    const res = await app.inject({ method: 'GET', url: '/foundry/launch' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toMatch(/\?t=/);
  });

  it('url starts with FOUNDRY_URL env value', async () => {
    process.env.FOUNDRY_URL        = 'https://foundry.example.com';
    process.env.FOUNDRY_JWT_SECRET = 'secret123';

    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb: {
        query: async () => ({
          rows:     [{ role: 'PLAYER', world: 'test-world', actor_name: 'Hero' }],
          rowCount: 1,
        }),
      },
    });

    const res  = await app.inject({ method: 'GET', url: '/foundry/launch' });
    const body = JSON.parse(res.body);

    expect(body.url).toMatch(/^https:\/\/foundry\.example\.com/);
  });

  it('token in url is a valid 3-segment JWT', async () => {
    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb: {
        query: async () => ({
          rows:     [{ role: 'PLAYER', world: 'main', actor_name: 'Okaj' }],
          rowCount: 1,
        }),
      },
    });

    const res  = await app.inject({ method: 'GET', url: '/foundry/launch' });
    const body = JSON.parse(res.body);

    const token = new URL(body.url).searchParams.get('t');
    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);
  });

  it('returns 404 when mapping is missing', async () => {
    const app = await build({
      mockUser: { id: 'u99', email: 'none@test.com', role: 'PLAYER', name: 'Ghost' },
      mockDb: {
        query: async () => ({ rows: [], rowCount: 0 }),
      },
    });

    const res = await app.inject({ method: 'GET', url: '/foundry/launch' });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/mapping not found/i);
  });

  it('GM with no actor_name gets a token with a=null', async () => {
    process.env.FOUNDRY_JWT_SECRET = 'secret123';

    const app = await build({
      mockUser: MOCK_USER_GM,
      mockDb: {
        query: async () => ({
          rows:     [{ role: 'GM', world: 'main', actor_name: null }],
          rowCount: 1,
        }),
      },
    });

    const res  = await app.inject({ method: 'GET', url: '/foundry/launch' });
    const body = JSON.parse(res.body);

    // Decode the token (no verification needed, just inspect payload)
    const [, b64] = body.url.split('?t=')[1]?.split('.') ?? [];
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));

    expect(payload.a).toBeNull();
    expect(payload.r).toBe('GM');
  });

  it('query receives the authenticated user email', async () => {
    const calls = [];

    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb: {
        query: async (sql, params) => {
          calls.push({ sql, params });
          return { rows: [{ role: 'PLAYER', world: 'w', actor_name: 'X' }], rowCount: 1 };
        },
      },
    });

    await app.inject({ method: 'GET', url: '/foundry/launch' });

    expect(calls[0].params).toContain(MOCK_USER_PLAYER.email);
  });
});
