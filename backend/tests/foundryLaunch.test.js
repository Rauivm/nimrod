import { describe, it, expect } from 'vitest';
import { build } from '../src/app.js';

const MOCK_USER_PLAYER = { id: 'u1', email: 'player@test.com', role: 'PLAYER', name: 'Player One' };
const MOCK_USER_GM     = { id: 'u2', email: 'gm@test.com',     role: 'GM',     name: 'Game Master' };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a pool mock that simulates an existing mapping (fast-path: query only).
 * The SELECT returns one row immediately; connect() is never called.
 */
function existingMappingPool(row) {
  return {
    query: async () => ({ rows: [row], rowCount: 1 }),
  };
}

/**
 * Build a pool mock that simulates a new user (slow-path: transaction).
 * query()  → rowCount:0  (no existing mapping)
 * connect() → client that runs the serializable transaction
 */
function newUserPool({ countTotal, insertedRow }) {
  const client = {
    query: async (sql) => {
      if (/BEGIN/i.test(sql))  return {};
      if (/COMMIT/i.test(sql)) return {};
      if (/COUNT/i.test(sql))  return { rows: [{ total: countTotal }] };
      // INSERT ... RETURNING
      return { rows: [insertedRow], rowCount: 1 };
    },
    release: () => {},
  };
  return {
    query: async () => ({ rows: [], rowCount: 0 }),   // existing-check returns empty
    connect: async () => client,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /foundry/launch', () => {

  it('returns 200 with a url containing ?t= for an existing mapping', async () => {
    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb:   existingMappingPool({ role: 'PLAYER', world: 'main', actor_name: 'Okaj' }),
    });

    const res = await app.inject({ method: 'GET', url: '/foundry/launch' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toMatch(/\?t=/);
  });

  it('url starts with FOUNDRY_URL env value', async () => {
    process.env.FOUNDRY_URL        = 'https://foundry.example.com';
    process.env.FOUNDRY_JWT_SECRET = 'secret123';

    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb:   existingMappingPool({ role: 'PLAYER', world: 'test-world', actor_name: 'Hero' }),
    });

    const res  = await app.inject({ method: 'GET', url: '/foundry/launch' });
    const body = JSON.parse(res.body);

    expect(body.url).toMatch(/^https:\/\/foundry\.example\.com/);
  });

  it('token in url is a valid 3-segment JWT', async () => {
    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb:   existingMappingPool({ role: 'PLAYER', world: 'main', actor_name: 'Okaj' }),
    });

    const res   = await app.inject({ method: 'GET', url: '/foundry/launch' });
    const token = new URL(JSON.parse(res.body).url).searchParams.get('t');

    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);
  });

  it('auto-provisions first user as GM when table is empty', async () => {
    process.env.FOUNDRY_JWT_SECRET = 'secret123';

    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb:   newUserPool({
        countTotal:  0,
        insertedRow: { role: 'GM', world: 'main', actor_name: null },
      }),
    });

    const res   = await app.inject({ method: 'GET', url: '/foundry/launch' });
    expect(res.statusCode).toBe(200);

    const token   = new URL(JSON.parse(res.body).url).searchParams.get('t');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    expect(payload.r).toBe('GM');
  });

  it('auto-provisions subsequent users as PLAYER', async () => {
    process.env.FOUNDRY_JWT_SECRET = 'secret123';

    const app = await build({
      mockUser: MOCK_USER_PLAYER,
      mockDb:   newUserPool({
        countTotal:  1,
        insertedRow: { role: 'PLAYER', world: 'main', actor_name: null },
      }),
    });

    const res   = await app.inject({ method: 'GET', url: '/foundry/launch' });
    expect(res.statusCode).toBe(200);

    const token   = new URL(JSON.parse(res.body).url).searchParams.get('t');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    expect(payload.r).toBe('PLAYER');
  });

  it('GM with no actor_name gets a token with a=null', async () => {
    process.env.FOUNDRY_JWT_SECRET = 'secret123';

    const app = await build({
      mockUser: MOCK_USER_GM,
      mockDb:   existingMappingPool({ role: 'GM', world: 'main', actor_name: null }),
    });

    const res     = await app.inject({ method: 'GET', url: '/foundry/launch' });
    const token   = new URL(JSON.parse(res.body).url).searchParams.get('t');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    expect(payload.a).toBeNull();
    expect(payload.r).toBe('GM');
  });

  it('passes the authenticated user email through to the mapping lookup', async () => {
    const calls = [];

    const mockDb = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ role: 'PLAYER', world: 'w', actor_name: 'X' }], rowCount: 1 };
      },
    };

    const app = await build({ mockUser: MOCK_USER_PLAYER, mockDb });

    await app.inject({ method: 'GET', url: '/foundry/launch' });

    expect(calls[0].params).toContain(MOCK_USER_PLAYER.email);
  });

});
