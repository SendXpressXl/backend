const rateLimitMap = new Map();

// Hard cap to prevent unbounded memory growth under high load
// Each entry is ~200 bytes, so 50,000 entries ≈ 10MB
const MAX_ENTRIES = 50_000;

/**
 * Simple in-memory rate limiter with bounded memory usage.
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs   - Time window in milliseconds
 */
function rateLimit(maxRequests = 60, windowMs = 60_000) {
  return (req, res, next) => {
    const key = req.headers['x-wallet-address'] || req.ip;
    const now = Date.now();

    // Evict oldest entries if at capacity (LRU eviction)
    if (rateLimitMap.size >= MAX_ENTRIES) {
      const toDelete = [...rateLimitMap.entries()]
        .sort(([, a], [, b]) => a.start - b.start)
        .slice(0, Math.floor(MAX_ENTRIES * 0.1))
        .map(([k]) => k);
      toDelete.forEach(k => rateLimitMap.delete(k));
    }

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, { count: 1, start: now });
      return next();
    }

    const entry = rateLimitMap.get(key);

    if (now - entry.start > windowMs) {
      rateLimitMap.set(key, { count: 1, start: now });
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      return res.status(429).json({
        error: 'Too many requests. Please slow down.',
        retryAfterSeconds: retryAfter,
      });
    }

    entry.count++;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    next();
  };
}

// Prune stale entries every window (60s) to match rate limit window
// Cutoff equals windowMs to ensure entries don't linger beyond their window
setInterval(() => {
  const cutoff = Date.now() - 60_000; // 60s cutoff matches the default window
  let prunedCount = 0;
  for (const [key, entry] of rateLimitMap.entries()) {
    if (entry.start < cutoff) {
      rateLimitMap.delete(key);
      prunedCount++;
    }
  }
}, 60_000);

// Log map size every minute for monitoring
setInterval(() => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'rate_limit_map_size',
    size: rateLimitMap.size,
    maxEntries: MAX_ENTRIES,
    ts: Date.now()
  }));
}, 60_000);

module.exports = { rateLimit, rateLimitMap, MAX_ENTRIES };
