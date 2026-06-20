function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeObjectId(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function clampNumber(value, { minimum = 1, maximum = 100, fallback = minimum } = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(numericValue), minimum), maximum);
}

function getPaginationParams(query, defaults = {}) {
  const page = clampNumber(query.page, {
    minimum: 1,
    maximum: defaults.maxPage || 1000,
    fallback: defaults.page || 1,
  });
  const limit = clampNumber(query.limit, {
    minimum: 1,
    maximum: defaults.maxLimit || 500,
    fallback: defaults.limit || 100,
  });

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

module.exports = {
  normalizeIdentifier,
  normalizeObjectId,
  clampNumber,
  getPaginationParams,
};
