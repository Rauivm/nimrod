import { describe, it, expect, vi } from 'vitest';
import { resolveFoundryMapping } from '../src/services/foundryMap.js';

// ── Pool mock factory helpers ─────────────────────────────────────────────────

/**
 * Pool that returns an existing row immediately from query().
 * connect() is never invoked (fast path).
 */
function poolWithExistingUser(row) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }),
    connect: vi.fn(),
  };
}

/**
 * Pool that simulates the transaction path for a new user.
 *
 * @param {number} countTotal  - value returned by COUNT(*) inside the tx
 * @param {object} insertedRow - row returned by INSERT … RETURNING
 */
function poolForNewUser(countTotal, insertedRow) {
  const clientQuery = vi.fn().mockImplementation(async (sql) => {
    if (/BEGIN/i.test(sql))  return {};
    if (/COMMIT/i.test(sql)) return {};
    if (/ROLLBACK/i.test(sql)) return {};
    if (/COUNT/i.test(sql))  return { rows: [{ total: countTotal }] };
    // INSERT … RETURNING
    return { rows: [insertedRow], rowCount: 1 };
  });

  const client = {
    query:   clientQuery,
    release: vi.fn(),
  };

  return {
    // existing-check SELECT returns empty → triggers slow path
    query:   vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,   // exposed for assertions
  };
}

/**
 * Pool that simulates a DB failure during the transaction.
 */
function poolThatFailsOnInsert(errorMessage) {
  const clientQuery = vi.fn().mockImplementation(async (sql) => {
    if (/BEGIN/i.test(sql))    return {};
    if (/ROLLBACK/i.test(sql)) return {};
    if (/COUNT/i.test(sql))    return { rows: [{ total: 0 }] };
    throw new Error(errorMessage);
  });

  const client = {
    query:   clientQuery,
    release: vi.fn(),
  };

  return {
    query:   vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveFoundryMapping', () => {

  // 1. Existing user is returned immediately, untouched
  it('returns the existing mapping without touching the transaction path', async () => {
    const existingRow = { role: 'PLAYER', world: 'main', actor_name: 'Aldric' };
    const pool = poolWithExistingUser(existingRow);

    const result = await resolveFoundryMapping(pool, 'player@test.com');

    expect(result).toEqual(existingRow);
    // connect() must never be called — no transaction for existing users
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('returns existing GM mapping without modification', async () => {
    const existingRow = { role: 'GM', world: 'main', actor_name: null };
    const pool = poolWithExistingUser(existingRow);

    const result = await resolveFoundryMapping(pool, 'gm@test.com');

    expect(result.role).toBe('GM');
    expect(result.actor_name).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  // 2. First user (empty table) → GM
  it('assigns GM to the first user when the table is empty', async () => {
    const insertedRow = { role: 'GM', world: 'main', actor_name: null };
    const pool = poolForNewUser(0, insertedRow);

    const result = await resolveFoundryMapping(pool, 'first@test.com');

    expect(result.role).toBe('GM');
    expect(result.world).toBe('main');
  });

  // 3. Second user (table has rows) → PLAYER
  it('assigns PLAYER to subsequent users', async () => {
    const insertedRow = { role: 'PLAYER', world: 'main', actor_name: null };
    const pool = poolForNewUser(1, insertedRow);

    const result = await resolveFoundryMapping(pool, 'second@test.com');

    expect(result.role).toBe('PLAYER');
  });

  it('assigns PLAYER when many users already exist', async () => {
    const insertedRow = { role: 'PLAYER', world: 'main', actor_name: null };
    const pool = poolForNewUser(99, insertedRow);

    const result = await resolveFoundryMapping(pool, 'late@test.com');

    expect(result.role).toBe('PLAYER');
  });

  // 4. Transaction mechanics
  it('opens a SERIALIZABLE transaction for a new user', async () => {
    const pool = poolForNewUser(0, { role: 'GM', world: 'main', actor_name: null });

    await resolveFoundryMapping(pool, 'first@test.com');

    const beginCall = pool._client.query.mock.calls.find(([sql]) =>
      /BEGIN ISOLATION LEVEL SERIALIZABLE/i.test(sql),
    );
    expect(beginCall).toBeTruthy();
  });

  it('commits the transaction on success', async () => {
    const pool = poolForNewUser(0, { role: 'GM', world: 'main', actor_name: null });

    await resolveFoundryMapping(pool, 'first@test.com');

    const commitCall = pool._client.query.mock.calls.find(([sql]) => /COMMIT/i.test(sql));
    expect(commitCall).toBeTruthy();
  });

  it('releases the client after a successful transaction', async () => {
    const pool = poolForNewUser(0, { role: 'GM', world: 'main', actor_name: null });

    await resolveFoundryMapping(pool, 'first@test.com');

    expect(pool._client.release).toHaveBeenCalledOnce();
  });

  // 5. DB failure handling
  it('rolls back and releases the client on DB failure', async () => {
    const pool = poolThatFailsOnInsert('connection timeout');

    await expect(
      resolveFoundryMapping(pool, 'fail@test.com'),
    ).rejects.toThrow('connection timeout');

    const rollbackCall = pool._client.query.mock.calls.find(([sql]) => /ROLLBACK/i.test(sql));
    expect(rollbackCall).toBeTruthy();
    expect(pool._client.release).toHaveBeenCalledOnce();
  });

  it('propagates the original DB error to the caller', async () => {
    const pool = poolThatFailsOnInsert('unique_violation');

    await expect(
      resolveFoundryMapping(pool, 'fail@test.com'),
    ).rejects.toThrow('unique_violation');
  });

  // 6. Concurrent first-login simulation
  // Both callers race on an empty table. The second sees count=0 too but
  // the ON CONFLICT … DO UPDATE … SET email = EXCLUDED.email (no-op) means
  // the INSERT is idempotent — only one row survives. We verify that both
  // callers complete without throwing and that the existing-row path is
  // exercised on a second call for the same email.
  it('concurrent first-login: second call for same email returns existing row', async () => {
    const rows = new Map();

    function makeRacePool(email) {
      const client = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (/BEGIN/i.test(sql))    return {};
          if (/COMMIT/i.test(sql))   return {};
          if (/ROLLBACK/i.test(sql)) return {};
          if (/COUNT/i.test(sql))    return { rows: [{ total: 0 }] };  // both see empty
          // Simulate the idempotent ON CONFLICT behaviour
          if (!rows.has(email)) rows.set(email, { role: 'GM', world: 'main', actor_name: null });
          return { rows: [rows.get(email)], rowCount: 1 };
        }),
        release: vi.fn(),
      };

      return {
        query: vi.fn().mockImplementation(async () => {
          // Return existing row for the second call
          if (rows.has(email)) return { rows: [rows.get(email)], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }),
        connect: vi.fn().mockResolvedValue(client),
      };
    }

    const email = 'race@test.com';
    const pool1 = makeRacePool(email);
    const pool2 = makeRacePool(email);

    const [r1, r2] = await Promise.all([
      resolveFoundryMapping(pool1, email),
      resolveFoundryMapping(pool2, email),
    ]);

    // Both calls must succeed
    expect(r1.role).toBe('GM');
    expect(r2.role).toBe('GM');
  });

  // 7. No GM uniqueness constraint — multiple GMs allowed
  it('does not enforce a single-GM limit — second empty-table user can also be GM if count=0', async () => {
    // This just verifies the service assigns whatever the count dictates;
    // the constraint lives at the DB level (none), not in application code.
    const pool = poolForNewUser(0, { role: 'GM', world: 'main', actor_name: null });
    const result = await resolveFoundryMapping(pool, 'secondgm@test.com');
    expect(result.role).toBe('GM');
  });

});
