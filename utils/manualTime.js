const { createTimeZoneStartOfDay, getTimeZoneParts, getDateBoundsFromQuery } = require('./date');

function parseManualRange(date, fromTime, toTime) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
  const [year, month, day] = date.split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.toISOString().slice(0, 10) !== date) throw new Error('Invalid date.');
  const parseTime = (value, allowMidnight) => {
    if (allowMidnight && value === '24:00') return 1440;
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Invalid time.');
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const from = parseTime(fromTime, false);
  const to = parseTime(toTime, true);
  if (to <= from) throw new Error('End time must be after start time on the selected date.');
  const bounds = getDateBoundsFromQuery(date);
  const resolve = (minutes) => {
    if (minutes === 1440) return bounds.end;
    let result = new Date(createTimeZoneStartOfDay(year, month, day).getTime() + minutes * 60000);
    // Correct for an offset change within the selected calendar day.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = getTimeZoneParts(result);
      const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
      result = new Date(result.getTime() + Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60) - actual);
    }
    const parts = getTimeZoneParts(result);
    if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour * 60 + parts.minute !== minutes) throw new Error('This local time does not exist.');
    return result;
  };
  const startedAt = resolve(from);
  const endedAt = resolve(to);
  if (endedAt <= startedAt) throw new Error('Invalid time range.');
  return { startedAt, endedAt };
}

module.exports = { parseManualRange };
