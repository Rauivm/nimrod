import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../src/db/index.js', () => ({ query: vi.fn(), pool: {} }));
vi.mock('../src/ws/broadcast.js', () => ({ broadcast: vi.fn() }));
vi.mock('../src/services/foundrySync.js', () => ({
  readFoundryActorsDb: vi.fn(),
  syncFoundryActors: vi.fn(),
  upsertFoundryActors: vi.fn(),
}));

import { query } from '../src/db/index.js';
import { broadcast } from '../src/ws/broadcast.js';
import { readFoundryActorsDb } from '../src/services/foundrySync.js';
import { profileRoutes } from '../src/routes/profile.js';
import { foundryRoutes } from '../src/routes/foundry.js';

const GM_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_ID = '22222222-2222-4222-8222-222222222222';
const CHARACTER_ID = '33333333-3333-4333-8333-333333333333';
const MANUAL_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR_ID = 'syntheticActorId1';
const CHARACTER = {
  id: CHARACTER_ID,
  foundry_actor_id: ACTOR_ID,
  user_id: PLAYER_ID,
  user_display_name: 'Synthetic Player',
  name: 'Synthetic Character',
  level: 5,
  token_img: 'worlds/synthetic/token.webp',
  classe: 'Fighter',
  active: true,
  retired: false,
  dead: false,
};

let apps;

async function buildApp(role = 'GM') {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async req => { req.user = { id: GM_ID, role }; });
  // Register both real route plugins, as index.js does, to catch duplicate paths
  // and make sure the management list is not served by the Foundry actor reader.
  await app.register(foundryRoutes);
  await app.register(profileRoutes);
  await app.ready();
  apps.push(app);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  apps = [];
});

afterEach(async () => {
  await Promise.all(apps.map(app => app.close()));
});

describe('Character management identifiers', () => {
  it.each(['GM', 'GM_PRINCIPAL'])('lists persisted UUIDs and owners for %s, including manual characters', async role => {
    query.mockResolvedValue({ rows: [
      CHARACTER,
      { ...CHARACTER, id: MANUAL_ID, foundry_actor_id: null, user_id: null, user_display_name: null },
    ] });
    const app = await buildApp(role);
    const response = await app.inject('/foundry/actors/all-characters');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: CHARACTER_ID, foundryActorId: ACTOR_ID, userId: PLAYER_ID,
        userDisplayName: 'Synthetic Player', level: 5, tokenImg: CHARACTER.token_img,
      }),
      expect.objectContaining({ id: MANUAL_ID, foundryActorId: null, userId: null }),
    ]);
    expect(readFoundryActorsDb).not.toHaveBeenCalled();
  });

  it('does not expose the administrative list to a PLAYER', async () => {
    const app = await buildApp('PLAYER');
    expect((await app.inject('/foundry/actors/all-characters')).statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the Actor ID contract on the integration endpoint', async () => {
    readFoundryActorsDb.mockResolvedValue({ available: true, actors: [{ id: ACTOR_ID, name: 'Synthetic' }] });
    const app = await buildApp();
    const response = await app.inject('/foundry/actors');
    expect(response.statusCode).toBe(200);
    expect(response.json()[0].id).toBe(ACTOR_ID);
    expect(query).not.toHaveBeenCalled();
  });

  it('links the UUID returned by management, rather than sending the Foundry Actor ID to PostgreSQL', async () => {
    query.mockResolvedValueOnce({ rows: [CHARACTER] });
    const app = await buildApp();
    const [character] = (await app.inject('/foundry/actors/all-characters')).json();
    query.mockResolvedValueOnce({ rows: [{ ...CHARACTER, user_id: GM_ID }] });
    const response = await app.inject({
      method: 'PATCH', url: `/players/${GM_ID}/characters/${character.id}/link`, payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: CHARACTER_ID, foundryActorId: ACTOR_ID, userId: GM_ID });
    expect(query.mock.calls[1][1]).toEqual([GM_ID, CHARACTER_ID]);
  });

  it.each(['PATCH', 'DELETE'])('rejects a Foundry Actor ID before querying UUID columns (%s)', async method => {
    const app = await buildApp();
    const response = await app.inject({ method, url: `/players/${PLAYER_ID}/characters/${ACTOR_ID}/link` });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(['PATCH', 'DELETE'])('rejects an invalid player ID before querying (%s)', async method => {
    const app = await buildApp();
    const response = await app.inject({ method, url: `/players/invalid/characters/${CHARACTER_ID}/link` });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not allow a PLAYER to reassign someone else\'s character', async () => {
    const app = await buildApp('PLAYER');
    expect((await app.inject({ method: 'PATCH', url: `/players/${GM_ID}/characters/${CHARACTER_ID}/link` })).statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('Administrative unlink preserves characters', () => {
  it.each(['GM', 'GM_PRINCIPAL'])('%s can remove another player\'s link without deleting the character', async role => {
    query.mockResolvedValue({ rows: [{ ...CHARACTER, user_id: null }] });
    const app = await buildApp(role);
    const response = await app.inject({ method: 'DELETE', url: `/players/${PLAYER_ID}/characters/${CHARACTER_ID}/link` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: CHARACTER_ID, foundryActorId: ACTOR_ID, name: CHARACTER.name, userId: null });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE player_characters\s+SET user_id = NULL/);
    expect(sql).toMatch(/WHERE id = \$1 AND user_id = \$2/);
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(params).toEqual([CHARACTER_ID, PLAYER_ID]);
    expect(broadcast).toHaveBeenCalledWith('CHARACTER_UPDATED', {
      userId: PLAYER_ID, character: expect.objectContaining({ id: CHARACTER_ID, userId: null }),
    });
  });

  it('allows a GM to remove their own link too', async () => {
    query.mockResolvedValue({ rows: [{ ...CHARACTER, user_id: null }] });
    const app = await buildApp();
    expect((await app.inject({ method: 'DELETE', url: `/players/${GM_ID}/characters/${CHARACTER_ID}/link` })).statusCode).toBe(200);
    expect(query.mock.calls[0][1]).toEqual([CHARACTER_ID, GM_ID]);
  });

  it('rejects PLAYER calls to the administrative unlink endpoint', async () => {
    const app = await buildApp('PLAYER');
    expect((await app.inject({ method: 'DELETE', url: `/players/${PLAYER_ID}/characters/${CHARACTER_ID}/link` })).statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not remove a link if the displayed owner has changed', async () => {
    query.mockResolvedValue({ rows: [] });
    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: `/players/${PLAYER_ID}/characters/${CHARACTER_ID}/link` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatch(/Atualize a lista/);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('returns the newly unlinked character in management for reassignment', async () => {
    const app = await buildApp();
    query.mockResolvedValueOnce({ rows: [{ ...CHARACTER, user_id: null }] });
    await app.inject({ method: 'DELETE', url: `/players/${PLAYER_ID}/characters/${CHARACTER_ID}/link` });
    query.mockResolvedValueOnce({ rows: [{ ...CHARACTER, user_id: null, user_display_name: null }] });
    const response = await app.inject('/foundry/actors/all-characters');
    expect(response.json()[0]).toMatchObject({ id: CHARACTER_ID, userId: null, userDisplayName: null });
  });
});

it('serializes the existing database columns in the GM principal players panel', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID, display_name: 'Synthetic Player', total_missions: '2' }] });
  query.mockResolvedValueOnce({ rows: [CHARACTER] });
  const app = await buildApp('GM_PRINCIPAL');
  const response = await app.inject('/players');
  expect(response.statusCode).toBe(200);
  expect(response.json()[0].characters[0]).toMatchObject({ id: CHARACTER_ID, class: 'Fighter', tokenImgUrl: CHARACTER.token_img });
});
