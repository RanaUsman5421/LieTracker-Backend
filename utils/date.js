const DEFAULT_TRACKING_TIME_ZONE = 'Asia/Karachi';

function resolveTrackingTimeZone() {
  const configuredTimeZone = String(process.env.MONITASK_TIMEZONE || '').trim();
  const fallbackTimeZone = configuredTimeZone || DEFAULT_TRACKING_TIME_ZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fallbackTimeZone });
    return fallbackTimeZone;
  } catch (error) {
    return DEFAULT_TRACKING_TIME_ZONE;
  }
}

const TRACKING_TIME_ZONE = resolveTrackingTimeZone();
const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getTimeZoneParts(dateValue = new Date(), timeZone = TRACKING_TIME_ZONE) {
  const date = new Date(dateValue);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
    return result;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimeZoneOffsetMs(dateValue, timeZone = TRACKING_TIME_ZONE) {
  const date = new Date(dateValue);
  const parts = getTimeZoneParts(date, timeZone);
  const zonedTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );

  return zonedTimestamp - date.getTime();
}

function createTimeZoneStartOfDay(year, month, day, timeZone = TRACKING_TIME_ZONE) {
  const utcMidnightGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetMs = getTimeZoneOffsetMs(new Date(utcMidnightGuess), timeZone);
  return new Date(utcMidnightGuess - offsetMs);
}

function getStartOfDay(dateValue = new Date(), timeZone = TRACKING_TIME_ZONE) {
  const parts = getTimeZoneParts(dateValue, timeZone);
  return createTimeZoneStartOfDay(parts.year, parts.month, parts.day, timeZone);
}

function getTimeZoneDayOfWeek(dateValue = new Date(), timeZone = TRACKING_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  });

  return WEEKDAY_INDEX[formatter.format(new Date(dateValue))] ?? 0;
}

function getStartOfWeek(dateValue = new Date(), timeZone = TRACKING_TIME_ZONE) {
  const startOfDay = getStartOfDay(dateValue, timeZone);
  const dayOfWeek = getTimeZoneDayOfWeek(startOfDay, timeZone);
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return addDays(startOfDay, -daysSinceMonday);
}

function getStartOfMonth(dateValue = new Date(), timeZone = TRACKING_TIME_ZONE) {
  const parts = getTimeZoneParts(dateValue, timeZone);
  return createTimeZoneStartOfDay(parts.year, parts.month, 1, timeZone);
}

function formatDayKey(dateValue, timeZone = TRACKING_TIME_ZONE) {
  const parts = getTimeZoneParts(dateValue, timeZone);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

function parseDayKey(dateValue) {
  if (!dateValue) {
    return null;
  }

  const [year, month, day] = String(dateValue).split('-').map(Number);
  if ([year, month, day].some((part) => Number.isNaN(part))) {
    return null;
  }

  return createTimeZoneStartOfDay(year, month, day);
}

function addDays(dateValue, days) {
  const baseDate = typeof dateValue === 'string' ? parseDayKey(dateValue) : getStartOfDay(dateValue);
  const parts = getTimeZoneParts(baseDate);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0, 0));
  return createTimeZoneStartOfDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

function addMonths(dateValue, months, timeZone = TRACKING_TIME_ZONE) {
  const baseDate = typeof dateValue === 'string' ? parseDayKey(dateValue) : getStartOfDay(dateValue, timeZone);
  const parts = getTimeZoneParts(baseDate, timeZone);
  const shifted = new Date(Date.UTC(parts.year, (parts.month - 1) + months, parts.day, 12, 0, 0, 0));

  return createTimeZoneStartOfDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    timeZone
  );
}

function getDayKey(dateValue) {
  return formatDayKey(dateValue);
}

function getDateRangeForRecentDays(days) {
  const todayStart = getStartOfDay(new Date());
  const rangeStart = addDays(todayStart, -(days - 1));
  const rangeEnd = addDays(todayStart, 1);

  return {
    todayStart,
    yesterdayStart: addDays(todayStart, -1),
    weekStart: addDays(todayStart, -6),
    rangeStart,
    rangeEnd,
  };
}

function getDateBoundsFromQuery(dateValue) {
  const requestedDate = dateValue ? parseDayKey(dateValue) : new Date();
  const baseDate = !requestedDate || Number.isNaN(requestedDate.getTime()) ? new Date() : requestedDate;
  const start = getStartOfDay(baseDate);
  const end = addDays(start, 1);

  return { start, end };
}

module.exports = {
  TRACKING_TIME_ZONE,
  getTimeZoneParts,
  createTimeZoneStartOfDay,
  getStartOfDay,
  getStartOfWeek,
  getStartOfMonth,
  addDays,
  addMonths,
  getDayKey,
  parseDayKey,
  getDateRangeForRecentDays,
  getDateBoundsFromQuery,
};
