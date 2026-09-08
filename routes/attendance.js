const express = require('express');
const Attendance = require('../models/Attendance');
const TrackingEntry = require('../models/TrackingEntry');
const User = require('../models/User');
const { requireAuthenticatedUser } = require('../middleware/requireAuth');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { getDateBoundsFromQuery, getDayKey, parseDayKey } = require('../utils/date');
const {
  TRACKING_TIME_ZONE,
  finalizeExpiredAttendance,
  getWorkedDurationMs,
  serializeAttendance,
} = require('../services/attendance');

const router = express.Router();

function isValidDateKey(value) {
  const normalizedValue = String(value || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? parseDayKey(normalizedValue)
    : null;
  return Boolean(parsedDate) && getDayKey(parsedDate) === normalizedValue;
}

router.post('/check-in', requireAuthenticatedUser, async (req, res) => {
  try {
    const now = new Date();
    const dateKey = getDayKey(now);
    await finalizeExpiredAttendance(now);

    let attendance = await Attendance.findOne({
      adminId: req.authUser.adminId,
      userId: req.authUser._id,
      dateKey,
    });

    if (!attendance) {
      try {
        attendance = await Attendance.create({
          adminId: req.authUser.adminId,
          userId: req.authUser._id,
          dateKey,
          timezone: TRACKING_TIME_ZONE,
          checkInAt: now,
          checkInSource: req.body?.source === 'manual_button' ? 'manual_button' : 'tracking_start',
        });
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
        attendance = await Attendance.findOne({
          adminId: req.authUser.adminId,
          userId: req.authUser._id,
          dateKey,
        });
      }
    }

    res.json({ success: true, data: serializeAttendance(attendance, now) });
  } catch (error) {
    console.error('[Backend] Attendance check-in error:', error);
    res.status(500).json({ success: false, message: 'Unable to check in' });
  }
});

router.post('/check-out', requireAuthenticatedUser, async (req, res) => {
  try {
    const now = new Date();
    const dateKey = getDayKey(now);
    await finalizeExpiredAttendance(now);
    let attendance = await Attendance.findOne({
      adminId: req.authUser.adminId,
      userId: req.authUser._id,
      dateKey,
    });

    if (!attendance) {
      return res.status(409).json({ success: false, message: 'No active check-in was found for today' });
    }

    if (attendance.state === 'checked_in') {
      const updatedAttendance = await Attendance.findOneAndUpdate(
        { _id: attendance._id, state: 'checked_in' },
        {
          $set: {
            checkOutAt: now,
            checkOutMethod: 'manual',
            checkOutNote: 'Checked out by employee',
            workedDurationMs: getWorkedDurationMs(attendance.checkInAt, now),
            state: 'checked_out',
          },
        },
        { new: true }
      );
      attendance = updatedAttendance || await Attendance.findById(attendance._id);
    }

    res.json({ success: true, data: serializeAttendance(attendance, now) });
  } catch (error) {
    console.error('[Backend] Attendance check-out error:', error);
    res.status(500).json({ success: false, message: 'Unable to check out' });
  }
});

router.get('/status', requireAuthenticatedUser, async (req, res) => {
  try {
    const now = new Date();
    const dateKey = getDayKey(now);
    await finalizeExpiredAttendance(now);
    const attendance = await Attendance.findOne({
      adminId: req.authUser.adminId,
      userId: req.authUser._id,
      dateKey,
    }).lean();
    res.json({ success: true, data: serializeAttendance(attendance, now) });
  } catch (error) {
    console.error('[Backend] Attendance status error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch attendance status' });
  }
});

router.get('/', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const requestedDate = req.query.date ? String(req.query.date) : getDayKey(new Date());
    if (!isValidDateKey(requestedDate)) {
      return res.status(400).json({ success: false, message: 'Date must use YYYY-MM-DD format' });
    }

    await finalizeExpiredAttendance(new Date());
    const { start, end } = getDateBoundsFromQuery(requestedDate);
    const [users, records, trackedDurations] = await Promise.all([
      User.find({ adminId: req.adminId })
        .select('_id username email designation department dutyHours')
        .sort({ username: 1 })
        .lean(),
      Attendance.find({ adminId: req.adminId, dateKey: requestedDate }).lean(),
      TrackingEntry.aggregate([
        { $match: { adminId: req.adminId, timestamp: { $gte: start, $lt: end } } },
        { $group: { _id: '$userId', durationMs: { $sum: { $ifNull: ['$duration', 0] } } } },
      ]),
    ]);
    const recordByUser = new Map(records.map((record) => [String(record.userId), record]));
    const trackedDurationByUser = new Map(
      trackedDurations
        .filter((entry) => entry._id)
        .map((entry) => [String(entry._id), Number(entry.durationMs) || 0])
    );
    const now = new Date();
    const rows = users.map((user) => {
      const record = recordByUser.get(String(user._id));
      const serialized = record ? serializeAttendance(record, now).record : null;
      return {
        userId: user._id,
        name: user.username || user.email,
        email: user.email,
        role: user.designation || 'Employee',
        department: user.department || '',
        shift: `${Number(user.dutyHours ?? 8)}h duty`,
        checkInAt: serialized?.checkInAt || null,
        checkOutAt: serialized?.checkOutAt || null,
        checkOutMethod: serialized?.checkOutMethod || null,
        checkOutNote: serialized?.checkOutNote || '',
        attendanceDurationMs: serialized?.workedDurationMs || 0,
        workedDurationMs: trackedDurationByUser.get(String(user._id)) || 0,
        attendanceState: serialized?.state || 'not_checked_in',
        status: serialized ? 'present' : 'absent',
      };
    });
    const present = records.length;
    const checkedIn = records.filter((record) => record.state === 'checked_in').length;
    const checkedOut = records.filter((record) => record.state === 'checked_out').length;
    const automaticCheckouts = records.filter(
      (record) => record.checkOutMethod === 'automatic_midnight'
    ).length;
    const totalWorkedDurationMs = rows.reduce((sum, row) => sum + row.workedDurationMs, 0);

    res.json({
      success: true,
      data: {
        date: requestedDate,
        range: { start, end },
        rows,
        metrics: {
          total: users.length,
          present,
          absent: Math.max(0, users.length - present),
          checkedIn,
          checkedOut,
          automaticCheckouts,
          attendanceRate: users.length ? Math.round((present / users.length) * 100) : 0,
          averageWorkedDurationMs: present ? Math.round(totalWorkedDurationMs / present) : 0,
        },
      },
    });
  } catch (error) {
    console.error('[Backend] Attendance list error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch attendance records' });
  }
});

module.exports = router;
