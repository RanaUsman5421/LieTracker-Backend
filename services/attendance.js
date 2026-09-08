const Attendance = require('../models/Attendance');
const {
  TRACKING_TIME_ZONE,
  addDays,
  getDayKey,
  getTimeZoneParts,
  parseDayKey,
} = require('../utils/date');

const LATE_GRACE_MINUTES = 10;

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

function getAttendancePunctuality(
  checkInAt,
  dutyStartTime,
  timeZone = TRACKING_TIME_ZONE
) {
  const normalizedDutyStartTime = String(dutyStartTime || '').trim();
  const timeMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(normalizedDutyStartTime);
  const checkInDate = checkInAt ? new Date(checkInAt) : null;

  if (!timeMatch || !checkInDate || Number.isNaN(checkInDate.getTime())) {
    return {
      status: checkInDate ? 'present' : 'absent',
      lateSeverity: null,
      lateByMinutes: 0,
    };
  }

  const [dutyHour, dutyMinute] = normalizedDutyStartTime.split(':').map(Number);
  const checkInParts = getTimeZoneParts(checkInDate, timeZone);
  const dutyStartSeconds = ((dutyHour * 60) + dutyMinute) * 60;
  const checkInSeconds =
    ((checkInParts.hour * 60) + checkInParts.minute) * 60 + checkInParts.second;
  const lateBySeconds = checkInSeconds - dutyStartSeconds;

  if (lateBySeconds <= 0) {
    return { status: 'present', lateSeverity: null, lateByMinutes: 0 };
  }

  return {
    status: 'late',
    lateSeverity: lateBySeconds <= LATE_GRACE_MINUTES * 60 ? 'grace' : 'severe',
    lateByMinutes: Math.ceil(lateBySeconds / 60),
  };
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
      scheduledDutyStartTime: value.scheduledDutyStartTime || '',
      scheduledDutyEndTime: value.scheduledDutyEndTime || '',
      scheduleSnapshotAt: value.scheduleSnapshotAt || null,
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
  LATE_GRACE_MINUTES,
  TRACKING_TIME_ZONE,
  finalizeExpiredAttendance,
  getAttendancePunctuality,
  getAutomaticCheckoutAt,
  getWorkedDurationMs,
  serializeAttendance,
};
