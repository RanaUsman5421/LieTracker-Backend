const buckets = new Map();

function getClientKey(req) {
  return String(
    req.headers['x-forwarded-for']
      || req.ip
      || req.socket?.remoteAddress
      || 'unknown'
  );
}

function createRateLimiter({ windowMs, maxRequests, message }) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${req.method}:${req.path}:${getClientKey(req)}`;
    const current = buckets.get(key);

    if (!current || current.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= maxRequests) {
      res.status(429).json({ success: false, message });
      return;
    }

    current.count += 1;
    buckets.set(key, current);
    next();
  };
}

module.exports = {
  createRateLimiter,
};
