const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLatestDate(...values) {
  return values.reduce((latestDate, value) => {
    const date = normalizeDate(value);

    if (!date) {
      return latestDate;
    }

    if (!latestDate || date.getTime() > latestDate.getTime()) {
      return date;
    }

    return latestDate;
  }, null);
}

function getUserPresence(userLike, now = new Date()) {
  const referenceNow = normalizeDate(now) || new Date();
  const lastSeenAt = getLatestDate(userLike?.lastSeenAt, userLike?.lastScreenshotAt);
  const lastScreenshotAt = normalizeDate(userLike?.lastScreenshotAt);
  const isOnline = Boolean(
    lastSeenAt && referenceNow.getTime() - lastSeenAt.getTime() < ONLINE_WINDOW_MS
  );

  return {
    status: isOnline ? 'online' : 'offline',
    isOnline,
    offlineAfterMs: ONLINE_WINDOW_MS,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    lastScreenshotAt: lastScreenshotAt ? lastScreenshotAt.toISOString() : null,
  };
}

module.exports = {
  ONLINE_WINDOW_MS,
  getUserPresence,
};
