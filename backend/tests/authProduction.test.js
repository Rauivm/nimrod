import { afterEach, describe, it, expect, vi } from 'vitest';
describe('Production authentication uses authenticated identity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('does not allow a copied development identity or X-Dev-User in production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_USER_EMAIL', 'synthetic@example.test');
    vi.stubEnv('DEV_USER_ROLE', 'GM');
    const query = vi.fn();
    vi.doMock('../src/db/index.js', () => ({
      query
    }));
    const {
      cfAuthMiddleware
    } = await import('../src/middleware/auth.js');
    const req = {
      headers: {
        'x-dev-user': 'synthetic@example.test'
      }
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    };
    await cfAuthMiddleware(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(req.user).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
