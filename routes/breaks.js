const express = require('express');
const DailyBreak = require('../models/DailyBreak');
const User = require('../models/User');
const { requireAuthenticatedUser } = require('../middleware/requireAuth');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { addDays, getDayKey, parseDayKey } = require('../utils/date');
const { buildUserLookupQuery } = require('../utils/tracking');

const router = express.Router();
const DAILY_BREAK_ALLOWANCE_MS = 60 * 60 * 1000;

function closedTotals(record) {
  return (record?.sessions || []).reduce((totals, session) => {
    totals.breakDurationMs += Math.max(0, Number(session.breakDurationMs) || 0);
    totals.overtimeDurationMs += Math.max(0, Number(session.overtimeDurationMs) || 0);
    return totals;
  }, { breakDurationMs: 0, overtimeDurationMs: 0 });
}

function serializeBreak(record, now = new Date()) {
  const allowanceMs = Math.max(0, Number(record?.allowanceMs) || DAILY_BREAK_ALLOWANCE_MS);
  const totals = closedTotals(record);
  const activeStartedAt = record?.activeStartedAt ? new Date(record.activeStartedAt) : null;
  const activeDurationMs = activeStartedAt
    ? Math.max(0, now.getTime() - activeStartedAt.getTime())
    : 0;
  const remainingBeforeActiveMs = Math.max(0, allowanceMs - totals.breakDurationMs);
  const activeBreakDurationMs = Math.min(remainingBeforeActiveMs, activeDurationMs);
  const activeOvertimeDurationMs = Math.max(0, activeDurationMs - activeBreakDurationMs);
  const breakDurationMs = totals.breakDurationMs + activeBreakDurationMs;
  const overtimeDurationMs = totals.overtimeDurationMs + activeOvertimeDurationMs;

  return {
    id: record?._id || null,
    dateKey: record?.dateKey || getDayKey(now),
    active: Boolean(activeStartedAt),
    activeStartedAt,
    allowanceMs,
    breakDurationMs,
    overtimeDurationMs,
    remainingMs: Math.max(0, allowanceMs - breakDurationMs),
    activeDurationMs,
    activeBreakDurationMs,
    activeOvertimeDurationMs,
    sessions: record?.sessions || [],
  };
}

async function getTodayRecord(user, create = false) {
  const query = { adminId: user.adminId, userId: user._id, dateKey: getDayKey(new Date()) };
  if (!create) return DailyBreak.findOne(query);
  return DailyBreak.findOneAndUpdate(
    query,
    { $setOnInsert: { allowanceMs: DAILY_BREAK_ALLOWANCE_MS, sessions: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function closeActiveBreak(record, endedAt) {
  if (!record?.activeStartedAt) return record;
  const startedAt = new Date(record.activeStartedAt);
  const elapsedMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const usedMs = closedTotals(record).breakDurationMs;
  const breakDurationMs = Math.min(Math.max(0, record.allowanceMs - usedMs), elapsedMs);
  record.sessions.push({
    startedAt,
    endedAt,
    breakDurationMs,
    overtimeDurationMs: Math.max(0, elapsedMs - breakDurationMs),
  });
  record.activeStartedAt = null;
  await record.save();
  return record;
}

async function finalizeExpiredBreaks(user, now = new Date()) {
  const today = getDayKey(now);
  const expired = await DailyBreak.find({
    adminId: user.adminId,
    userId: user._id,
    dateKey: { $lt: today },
    activeStartedAt: { $ne: null },
  });
  await Promise.all(expired.map((record) => {
    const dayStart = parseDayKey(record.dateKey);
    return closeActiveBreak(record, dayStart ? addDays(dayStart, 1) : now);
  }));
}

router.get('/status', requireAuthenticatedUser, async (req, res) => {
  try {
    await finalizeExpiredBreaks(req.authUser);
    const record = await getTodayRecord(req.authUser, false);
    res.json({ success: true, data: serializeBreak(record) });
  } catch (error) {
    console.error('[Backend] Break status error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch break status' });
  }
});

router.post('/start', requireAuthenticatedUser, async (req, res) => {
  try {
    await finalizeExpiredBreaks(req.authUser);
    const record = await getTodayRecord(req.authUser, true);
    if (!record.activeStartedAt) {
      record.activeStartedAt = new Date();
      await record.save();
    }
    res.json({ success: true, data: serializeBreak(record) });
  } catch (error) {
    console.error('[Backend] Break start error:', error);
    res.status(500).json({ success: false, message: 'Unable to start break' });
  }
});

router.post('/stop', requireAuthenticatedUser, async (req, res) => {
  try {
    await finalizeExpiredBreaks(req.authUser);
    const record = await getTodayRecord(req.authUser, false);
    if (!record?.activeStartedAt) {
      return res.json({ success: true, data: serializeBreak(record) });
    }

    const endedAt = new Date();
    await closeActiveBreak(record, endedAt);
    res.json({ success: true, data: serializeBreak(record, endedAt) });
  } catch (error) {
    console.error('[Backend] Break stop error:', error);
    res.status(500).json({ success: false, message: 'Unable to stop break' });
  }
});

router.get('/user/:identifier', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const user = await User.findOne(buildUserLookupQuery({
      userId: req.params.identifier,
      userEmail: req.params.identifier,
      adminId: req.adminId,
    })).select('_id adminId').lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await finalizeExpiredBreaks(user);

    const query = { adminId: req.adminId, userId: user._id };
    if (req.query.startDate || req.query.endDate) {
      query.dateKey = {};
      if (req.query.startDate) query.dateKey.$gte = String(req.query.startDate);
      if (req.query.endDate) query.dateKey.$lte = String(req.query.endDate);
    }
    const records = await DailyBreak.find(query).sort({ dateKey: 1 }).lean();
    const days = records.map((record) => serializeBreak(record));
    res.json({
      success: true,
      data: {
        days,
        breakDurationMs: days.reduce((sum, day) => sum + day.breakDurationMs, 0),
        overtimeDurationMs: days.reduce((sum, day) => sum + day.overtimeDurationMs, 0),
      },
    });
  } catch (error) {
    console.error('[Backend] User break summary error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch user break summary' });
  }
});

module.exports = router;
