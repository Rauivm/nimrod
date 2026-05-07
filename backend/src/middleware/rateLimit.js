const buckets = new Map();

function keyFor(req, scope) {
  return `${scope}:${req.user?.id || req.ip || 'anonymous'}`;
}

export function assertRateLimit(req, reply, scope, { limit, windowMs }) {
  const now = Date.now();
  const key = keyFor(req, scope);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  if (bucket.count <= limit) return true;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  reply.header('Retry-After', retryAfter);
  reply.code(429).send({ error: 'Too many requests. Try again soon.' });
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();
