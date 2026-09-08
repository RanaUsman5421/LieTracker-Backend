const Attendance = require('../models/Attendance');
const { TRACKING_TIME_ZONE, addDays, getDayKey, parseDayKey } = require('../utils/date');

function getAutomaticCheckoutAt(dateKey) {
  const dayStart = parseDayKey(dateKey);
  return dayStart ? addDays(dayStart, 1) : new Date();
}

function getWorkedDurationMs(checkInAt, checkOutAt) {
  const startMs = new Date(checkInAt).getTime();
  const endMs = new Date(checkOutAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 0;
  }
  return Math.max(0, endMs - startMs);
}

async function finalizeExpiredAttendance(now = new Date()) {
  const todayKey = getDayKey(now);
  const expiredRecords = await Attendance.find({
    state: 'checked_in',
    dateKey: { $lt: todayKey },
  });

  if (!expiredRecords.length) {
    return 0;
  }

  const operations = expiredRecords.map((record) => {
    const checkOutAt = getAutomaticCheckoutAt(record.dateKey);
    return {
      updateOne: {
        filter: { _id: record._id, state: 'checked_in' },
        update: {
          $set: {
            checkOutAt,
            checkOutMethod: 'automatic_midnight',
            checkOutNote: 'Automatically checked out at 12:00 AM',
            workedDurationMs: getWorkedDurationMs(record.checkInAt, checkOutAt),
            state: 'checked_out',
          },
        },
      },
    };
  });

  const result = await Attendance.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
}

function serializeAttendance(record, now = new Date()) {
  if (!record) {
    return {
      checkedIn: false,
      checkedOut: false,
      dateKey: getDayKey(now),
      record: null,
    };
  }

  const value = typeof record.toObject === 'function' ? record.toObject() : record;
  const effectiveEnd = value.checkOutAt || now;
  return {
    checkedIn: value.state === 'checked_in',
    checkedOut: value.state === 'checked_out',
    dateKey: value.dateKey,
    record: {
      id: value._id,
      userId: value.userId,
      checkInAt: value.checkInAt,
      checkInSource: value.checkInSource,
      checkOutAt: value.checkOutAt,
      checkOutMethod: value.checkOutMethod,
      checkOutNote: value.checkOutNote,
      recheckStatus: value.recheckApproval?.status || 'none',
      recheckReviewedAt: value.recheckApproval?.reviewedAt || null,
      recheckCount: Number(value.recheckCount) || 0,
      workedDurationMs: value.checkOutAt
        ? value.workedDurationMs
        : getWorkedDurationMs(value.checkInAt, effectiveEnd),
      state: value.state,
      timezone: value.timezone,
    },
  };
}

module.exports = {
  TRACKING_TIME_ZONE,
  finalizeExpiredAttendance,
  getAutomaticCheckoutAt,
  getWorkedDurationMs,
  serializeAttendance,
};
