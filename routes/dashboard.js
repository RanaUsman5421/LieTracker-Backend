const express = require('express');
const DailyBreak = require('../models/DailyBreak');
const Screenshot = require('../models/Screenshot');
const TrackingEntry = require('../models/TrackingEntry');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { withCachedSummary } = require('../services/summaryCache');
const {
  TRACKING_TIME_ZONE,
  addDays,
  getDateRangeForRecentDays,
  getDayKey,
  getStartOfMonth,
  parseDayKey,
} = require('../utils/date');
const {
  buildResolvedActiveDurationExpression,
  buildResolvedInactiveDurationExpression,
  buildUserAggregationKey,
} = require('../utils/tracking');

const router = express.Router();

router.use(requireDashboardAuthenticatedAdmin);

function getBreakOvertimeDuration(record, now = new Date()) {
  const closed = (record.sessions || []).reduce((totals, session) => ({
    breakDurationMs:
      totals.breakDurationMs + Math.max(0, Number(session.breakDurationMs) || 0),
    overtimeDurationMs:
      totals.overtimeDurationMs + Math.max(0, Number(session.overtimeDurationMs) || 0),
  }), { breakDurationMs: 0, overtimeDurationMs: 0 });

  if (!record.activeStartedAt) return closed.overtimeDurationMs;

  const activeStartedAt = new Date(record.activeStartedAt);
  if (Number.isNaN(activeStartedAt.getTime())) return closed.overtimeDurationMs;

  const recordDayStart = parseDayKey(record.dateKey);
  const effectiveEnd =
    record.dateKey === getDayKey(now) || !recordDayStart
      ? now
      : addDays(recordDayStart, 1);
  const activeDurationMs = Math.max(
    0,
    effectiveEnd.getTime() - activeStartedAt.getTime(),
  );
  const allowanceMs = Math.max(0, Number(record.allowanceMs) || 60 * 60 * 1000);
  const remainingAllowanceMs = Math.max(0, allowanceMs - closed.breakDurationMs);
  return closed.overtimeDurationMs + Math.max(0, activeDurationMs - remainingAllowanceMs);
}

router.get('/summary', async (req, res) => {
  try {
    const summary = await withCachedSummary(`dashboard-summary:${req.adminId}`, async () => {
      const { todayStart, yesterdayStart, weekStart, rangeEnd } = getDateRangeForRecentDays(7);
      const monthStart = getStartOfMonth(new Date());
      const summaryStart = monthStart < weekStart ? monthStart : weekStart;
      const todayKey = getDayKey(todayStart);
      const yesterdayKey = getDayKey(yesterdayStart);
      const weekKey = getDayKey(weekStart);
      const monthKey = getDayKey(monthStart);
      const summaryStartKey = getDayKey(summaryStart);
      const resolvedActiveDuration = buildResolvedActiveDurationExpression();
      const resolvedInactiveDuration = buildResolvedInactiveDurationExpression();
      const [trackingSummary, screenshotCounts, hourlyTrackingSummary, breakRecords] = await Promise.all([
        TrackingEntry.aggregate([
          {
            $match: {
              adminId: req.adminId,
              timestamp: {
                $gte: summaryStart,
                $lt: rangeEnd,
              },
            },
          },
          { $sort: { timestamp: -1 } },
          {
            $group: {
              _id: buildUserAggregationKey(),
              latestTimestamp: { $first: '$timestamp' },
              latestClassification: { $first: '$classification' },
              today: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', todayStart] }, { $ifNull: ['$duration', 0] }, 0],
                },
              },
              yesterday: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$timestamp', yesterdayStart] },
                        { $lt: ['$timestamp', todayStart] },
                      ],
                    },
                    { $ifNull: ['$duration', 0] },
                    0,
                  ],
                },
              },
              last7Days: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', weekStart] }, { $ifNull: ['$duration', 0] }, 0],
                },
              },
              thisMonth: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', monthStart] }, { $ifNull: ['$duration', 0] }, 0],
                },
              },
              activeToday: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', todayStart] }, resolvedActiveDuration, 0],
                },
              },
              inactiveToday: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', todayStart] }, resolvedInactiveDuration, 0],
                },
              },
              activeYesterday: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$timestamp', yesterdayStart] },
                        { $lt: ['$timestamp', todayStart] },
                      ],
                    },
                    resolvedActiveDuration,
                    0,
                  ],
                },
              },
              inactiveYesterday: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$timestamp', yesterdayStart] },
                        { $lt: ['$timestamp', todayStart] },
                      ],
                    },
                    resolvedInactiveDuration,
                    0,
                  ],
                },
              },
              activeLast7Days: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', weekStart] }, resolvedActiveDuration, 0],
                },
              },
              inactiveLast7Days: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', weekStart] }, resolvedInactiveDuration, 0],
                },
              },
              activeThisMonth: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', monthStart] }, resolvedActiveDuration, 0],
                },
              },
              inactiveThisMonth: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', monthStart] }, resolvedInactiveDuration, 0],
                },
              },
              keystrokesToday: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', todayStart] }, { $ifNull: ['$keystrokes', 0] }, 0],
                },
              },
              mouseClicksToday: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', todayStart] }, { $ifNull: ['$mouseClicks', 0] }, 0],
                },
              },
              activityEventsToday: {
                $sum: {
                  $cond: [{ $gte: ['$timestamp', todayStart] }, { $ifNull: ['$activityEvents', 0] }, 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              userId: '$_id.userId',
              userEmail: '$_id.userEmail',
              latestTimestamp: 1,
              latestClassification: 1,
              today: 1,
              yesterday: 1,
              last7Days: 1,
              thisMonth: 1,
              activeToday: 1,
              inactiveToday: 1,
              activeYesterday: 1,
              inactiveYesterday: 1,
              activeLast7Days: 1,
              inactiveLast7Days: 1,
              activeThisMonth: 1,
              inactiveThisMonth: 1,
              keystrokesToday: 1,
              mouseClicksToday: 1,
              activityEventsToday: 1,
            },
          },
          { $sort: { last7Days: -1 } },
        ]),
        Screenshot.aggregate([
          {
            $match: {
              adminId: req.adminId,
              timestamp: {
                $gte: todayStart,
                $lt: rangeEnd,
              },
            },
          },
          {
            $group: {
              _id: '$userId',
              screenshotCountToday: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              userId: '$_id',
              screenshotCountToday: 1,
            },
          },
        ]),
        TrackingEntry.aggregate([
          {
            $match: {
              adminId: req.adminId,
              timestamp: {
                $gte: todayStart,
                $lt: rangeEnd,
              },
            },
          },
          {
            $group: {
              _id: {
                $hour: {
                  date: '$timestamp',
                  timezone: TRACKING_TIME_ZONE,
                },
              },
              activeDuration: { $sum: resolvedActiveDuration },
              inactiveDuration: { $sum: resolvedInactiveDuration },
              activityEvents: { $sum: { $ifNull: ['$activityEvents', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              hour: '$_id',
              activeDuration: 1,
              inactiveDuration: 1,
              activityEvents: 1,
            },
          },
          { $sort: { hour: 1 } },
        ]),
        DailyBreak.find({
          adminId: req.adminId,
          dateKey: { $gte: summaryStartKey, $lte: todayKey },
        })
          .select('userId dateKey allowanceMs activeStartedAt sessions')
          .lean(),
      ]);

      const screenshotCountByUserId = new Map(
        screenshotCounts.map((item) => [String(item.userId || '').trim(), Number(item.screenshotCountToday) || 0])
      );

      const userSummaryById = new Map(
        trackingSummary.map((entry) => [String(entry.userId || '').trim(), { ...entry }])
      );

      breakRecords.forEach((record) => {
        const overtimeDuration = getBreakOvertimeDuration(record);
        if (!overtimeDuration) return;

        const userId = String(record.userId || '').trim();
        if (!userId) return;
        const entry = userSummaryById.get(userId) || {
          userId: record.userId,
          userEmail: null,
          latestTimestamp: record.activeStartedAt || null,
          latestClassification: 'idle',
          today: 0,
          yesterday: 0,
          last7Days: 0,
          thisMonth: 0,
          activeToday: 0,
          inactiveToday: 0,
          activeYesterday: 0,
          inactiveYesterday: 0,
          activeLast7Days: 0,
          inactiveLast7Days: 0,
          activeThisMonth: 0,
          inactiveThisMonth: 0,
          keystrokesToday: 0,
          mouseClicksToday: 0,
          activityEventsToday: 0,
        };

        if (record.dateKey === todayKey) {
          entry.today += overtimeDuration;
          entry.inactiveToday += overtimeDuration;
        }
        if (record.dateKey === yesterdayKey) {
          entry.yesterday += overtimeDuration;
          entry.inactiveYesterday += overtimeDuration;
        }
        if (record.dateKey >= weekKey) {
          entry.last7Days += overtimeDuration;
          entry.inactiveLast7Days += overtimeDuration;
        }
        if (record.dateKey >= monthKey) {
          entry.thisMonth += overtimeDuration;
          entry.inactiveThisMonth += overtimeDuration;
        }
        userSummaryById.set(userId, entry);
      });

      const userSummary = [...userSummaryById.values()]
        .map((entry) => ({
          ...entry,
          screenshotCountToday:
            screenshotCountByUserId.get(String(entry.userId || '').trim()) || 0,
        }))
        .sort((left, right) => (Number(right.last7Days) || 0) - (Number(left.last7Days) || 0));

      return {
        generatedAt: new Date().toISOString(),
        userSummary,
        hourlyActivity: hourlyTrackingSummary,
      };
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[Backend] Get dashboard summary error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch dashboard summary' });
  }
});

module.exports = router;
