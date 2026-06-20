const { SUMMARY_CACHE_TTL_MS } = require('../config/constants');

const summaryCache = new Map();

function clearSummaryCache() {
  summaryCache.clear();
}

async function withCachedSummary(cacheKey, resolver, ttlMs = SUMMARY_CACHE_TTL_MS) {
  const cached = summaryCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await resolver();
  summaryCache.set(cacheKey, {
    value,
    expiresAt: now + ttlMs,
  });
  return value;
}

module.exports = {
  clearSummaryCache,
  withCachedSummary,
};
