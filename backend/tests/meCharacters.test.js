import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Mock DB and WS Broadcast before importing profileRoutes
vi.mock('../src/db/index.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/ws/broadcast.js', () => ({
  broadcast: vi.fn(),
}));

// Now import mocked query, broadcast and profileRoutes
import { query } from '../src/db/index.js';
import { broadcast } from '../src/ws/broadcast.js';
import { profileRoutes } from '../src/routes/profile.js';

async function buildTestApp({ mockUser }) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _req, reply) => {
    reply.code(error.statusCode || 500).send({ error: error.message });
  });

  // Mock authentication hook
  app.addHook('preHandler', async (req) => {
    req.user = mockUser;
  });

  await app.register(profileRoutes);
  await app.ready();
  return app;
}

const PLAYER_USER = {
  id: 'u1',
  email: 'player@example.com',
  name: 'player',
  display_name: 'Player One',
  role: 'PLAYER',
};

const CHARACTER_ROW = {
  id: 'c1',
  foundry_actor_id: 'foundry-1',
  name: 'Thorin Oakenshield',
  level: 5,
  xp: 1200,
  xp_next: 3000,
  token_img: 'path/to/token.png',
  portrait_img: 'path/to/portrait.png',
  biography: 'A dwarf king.',
  system: 'dnd5e',
  active: true,
  retired: false,
  dead: false,
  user_id: PLAYER_USER.id,
  classe: 'Fighter',
  race: 'Dwarf',
};

describe('/me/characters routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /me/characters', () => {
    it('returns linked active characters for the authenticated user', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [CHARACTER_ROW],
        rowCount: 1,
      });
      vi.mocked(query).mockImplementation(mockQuery);

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'GET',
        url: '/me/characters',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('c1');
      expect(body[0].name).toBe('Thorin Oakenshield');
      expect(body[0].classe).toBe('Fighter');
      expect(body[0].race).toBe('Dwarf');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND active = TRUE AND retired = FALSE'),
        [PLAYER_USER.id]
      );
    });
  });

  describe('GET /me/characters/available', () => {
    it('returns characters available for linking', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [
          {
            ...CHARACTER_ROW,
            user_id: null,
            user_display_name: null,
          },
          {
            ...CHARACTER_ROW,
            user_id: PLAYER_USER.id,
            user_display_name: 'Player One',
          },
        ],
        rowCount: 2,
      });
      vi.mocked(query).mockImplementation(mockQuery);

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'GET',
        url: '/me/characters/available',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(2);
      
      // Unlinked character
      expect(body[0].id).toBe('c1');
      expect(body[0].isLinked).toBe(false);
      expect(body[0].userId).toBeNull();
      expect(body[0].userDisplayName).toBeNull();

      // Linked to current user
      expect(body[1].id).toBe('c1');
      expect(body[1].isLinked).toBe(true);
      expect(body[1].userId).toBe(PLAYER_USER.id);
      expect(body[1].userDisplayName).toBe('Player One');
    });
  });

  describe('POST /me/characters/:id/link', () => {
    it('successfully links an unlinked character to the authenticated user', async () => {
      const dbSelect = { rows: [{ ...CHARACTER_ROW, user_id: null }], rowCount: 1 };
      const dbUpdate = { rows: [CHARACTER_ROW], rowCount: 1 };
      
      let queryCount = 0;
      vi.mocked(query).mockImplementation(async () => {
        queryCount++;
        if (queryCount === 1) return dbSelect;
        return dbUpdate;
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url: `/me/characters/${CHARACTER_ROW.id}/link`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('c1');
      expect(body.userId).toBe(PLAYER_USER.id);
      
      expect(broadcast).toHaveBeenCalledWith(
        'CHARACTER_UPDATED',
        expect.objectContaining({
          userId: PLAYER_USER.id,
          character: expect.objectContaining({ id: 'c1' }),
        })
      );
    });

    it('returns 404 if character does not exist', async () => {
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url: '/me/characters/nonexistent/link',
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toMatch(/não encontrado/i);
    });

    it('returns 400 if character is retired', async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [{ ...CHARACTER_ROW, retired: true }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url: `/me/characters/${CHARACTER_ROW.id}/link`,
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/aposentado/i);
    });

    it('returns 400 if character is dead', async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [{ ...CHARACTER_ROW, dead: true }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url: `/me/characters/${CHARACTER_ROW.id}/link`,
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/morto/i);
    });

    it('returns 400 if character is already linked to another user', async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [{ ...CHARACTER_ROW, user_id: 'another-user-id' }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'POST',
        url: `/me/characters/${CHARACTER_ROW.id}/link`,
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/outro jogador/i);
    });
  });

  describe('DELETE /me/characters/:id/link', () => {
    it('successfully unlinks character currently owned by requesting user', async () => {
      const dbSelect = { rows: [CHARACTER_ROW], rowCount: 1 };
      const dbUpdate = { rows: [{ ...CHARACTER_ROW, user_id: null }], rowCount: 1 };

      let queryCount = 0;
      vi.mocked(query).mockImplementation(async () => {
        queryCount++;
        if (queryCount === 1) return dbSelect;
        return dbUpdate;
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'DELETE',
        url: `/me/characters/${CHARACTER_ROW.id}/link`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('c1');
      expect(body.userId).toBeNull();

      expect(broadcast).toHaveBeenCalledWith(
        'CHARACTER_UPDATED',
        expect.objectContaining({
          userId: PLAYER_USER.id,
          character: expect.objectContaining({ id: 'c1' }),
        })
      );
    });

    it('returns 403 if character is owned by another user', async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [{ ...CHARACTER_ROW, user_id: 'another-user-id' }],
        rowCount: 1,
      });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'DELETE',
        url: `/me/characters/${CHARACTER_ROW.id}/link`,
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/não tem permissão/i);
    });

    it('returns 404 if character does not exist', async () => {
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 });

      const app = await buildTestApp({ mockUser: PLAYER_USER });
      const res = await app.inject({
        method: 'DELETE',
        url: '/me/characters/nonexistent/link',
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toMatch(/não encontrado/i);
    });
  });
});
