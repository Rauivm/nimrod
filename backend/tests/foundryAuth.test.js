import { describe, it, expect } from 'vitest';
import { signFoundryToken, verifyFoundryToken } from '../src/services/foundryAuth.js';

const SECRET = 'test_secret';

describe('foundryAuth service', () => {
  describe('signFoundryToken', () => {
    it('returns a non-empty string', () => {
      const token = signFoundryToken({ e: 'a@b.com', r: 'PLAYER' }, SECRET);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('produces a three-segment JWT', () => {
      const token = signFoundryToken({ e: 'a@b.com' }, SECRET);
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('verifyFoundryToken', () => {
    it('round-trips email and role', () => {
      const payload = { e: 'test@test.com', r: 'PLAYER' };
      const token   = signFoundryToken(payload, SECRET);
      const decoded = verifyFoundryToken(token, SECRET);

      expect(decoded.e).toBe(payload.e);
      expect(decoded.r).toBe(payload.r);
    });

    it('round-trips all launch fields', () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        e:   'gm@example.com',
        r:   'GM',
        w:   'forgotten-realms',
        a:   'Aldric',
        exp: now + 60,
      };

      const decoded = verifyFoundryToken(signFoundryToken(payload, SECRET), SECRET);

      expect(decoded.e).toBe(payload.e);
      expect(decoded.r).toBe(payload.r);
      expect(decoded.w).toBe(payload.w);
      expect(decoded.a).toBe(payload.a);
    });

    it('preserves null actor', () => {
      const payload = { e: 'gm@example.com', r: 'GM', w: 'world', a: null };
      const decoded = verifyFoundryToken(signFoundryToken(payload, SECRET), SECRET);
      expect(decoded.a).toBeNull();
    });

    it('throws on a tampered token', () => {
      const token = signFoundryToken({ e: 'a@b.com' }, SECRET);
      const [h, p, s] = token.split('.');
      expect(() => verifyFoundryToken(`${h}.${p}.bad${s}`, SECRET)).toThrow();
    });

    it('throws on a completely invalid string', () => {
      expect(() => verifyFoundryToken('not.a.token', SECRET)).toThrow();
    });

    it('throws when signed with a different secret', () => {
      const token = signFoundryToken({ e: 'a@b.com' }, 'secret_a');
      expect(() => verifyFoundryToken(token, 'secret_b')).toThrow();
    });

    it('throws on an expired token', async () => {
      const payload = {
        e:   'a@b.com',
        exp: Math.floor(Date.now() / 1000) - 1,   // already expired
      };
      const token = signFoundryToken(payload, SECRET);
      expect(() => verifyFoundryToken(token, SECRET)).toThrow(/expired/i);
    });
  });
});
