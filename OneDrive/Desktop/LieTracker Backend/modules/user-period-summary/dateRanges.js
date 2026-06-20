const {
  addDays,
  addMonths,
  getStartOfDay,
  getStartOfMonth,
  getStartOfWeek,
  parseDayKey,
} = require('../../utils/date');

function parseDateValue(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  return parseDayKey(trimmedValue);
}

function buildSelectedRange({ startDate, endDate }) {
  const start = parseDateValue(startDate);
  const endDay = parseDateValue(endDate);

  if (!start || !endDay) {
    return null;
  }

  const end = addDays(endDay, 1);
  if (start >= end) {
    return null;
  }

  return { start, end };
}

function buildNamedRanges(now = new Date()) {
  const todayStart = getStartOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const yesterdayStart = addDays(todayStart, -1);
  const thisWeekStart = getStartOfWeek(now);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisMonthStart = getStartOfMonth(now);
  const nextMonthStart = addMonths(thisMonthStart, 1);
  const thisSixMonthsStart = addMonths(thisMonthStart, -5);
  const lastSixMonthsStart = addMonths(thisMonthStart, -11);
  const lastSixMonthsEnd = addMonths(thisMonthStart, -5);

  return {
    today: { start: todayStart, end: tomorrowStart },
    yesterday: { start: yesterdayStart, end: todayStart },
    thisWeek: { start: thisWeekStart, end: tomorrowStart },
    lastWeek: { start: lastWeekStart, end: thisWeekStart },
    thisMonth: { start: thisMonthStart, end: nextMonthStart },
    this6Months: { start: thisSixMonthsStart, end: tomorrowStart },
    last6Months: { start: lastSixMonthsStart, end: lastSixMonthsEnd },
    complete: { start: null, end: null },
  };
}

module.exports = {
  buildSelectedRange,
  buildNamedRanges,
};
