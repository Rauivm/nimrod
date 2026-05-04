import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { build } from '../src/app.js';

const SECRET = 'super_secret';

let app;
beforeAll(async () => {
  process.env.FOUNDRY_JWT_SECRET = SECRET;
  // /nimrod/verify doesn't touch the DB, so no mockDb needed
  app = await build({ mockUser: { id: 'u1', email: 'test@test.com', role: 'PLAYER', name: 'T' } });
});

describe('POST /nimrod/verify', () => {
  it('returns 200 with decoded payload for a valid token', async () => {
    const token = jwt.sign(
      { e: 'test@test.com', r: 'PLAYER', w: 'main', a: 'Okaj' },
      SECRET,
      { expiresIn: 60 },
    );

    const res  = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.email).toBe('test@test.com');
    expect(body.role).toBe('PLAYER');
    expect(body.world).toBe('main');
    expect(body.actor).toBe('Okaj');
  });

  it('returns actor: null when token has no actor', async () => {
    const token = jwt.sign(
      { e: 'gm@test.com', r: 'GM', w: 'main', a: null },
      SECRET,
      { expiresIn: 60 },
    );

    const res  = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).actor).toBeNull();
  });

  it('returns 401 for a token signed with wrong secret', async () => {
    const token = jwt.sign({ e: 'x@x.com', r: 'PLAYER' }, 'wrong_secret');

    const res = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign(
      { e: 'x@x.com', r: 'PLAYER', exp: Math.floor(Date.now() / 1000) - 1 },
      SECRET,
    );

    const res = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a completely invalid string', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: { token: 'not.a.jwt' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when token field is missing', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 for a tampered token', async () => {
    const token = jwt.sign({ e: 'a@b.com', r: 'PLAYER' }, SECRET, { expiresIn: 60 });
    const [h, p, s] = token.split('.');
    const tampered  = `${h}.${p}.x${s}`;

    const res = await app.inject({
      method:  'POST',
      url:     '/nimrod/verify',
      payload: { token: tampered },
    });

    expect(res.statusCode).toBe(401);
  });
});
