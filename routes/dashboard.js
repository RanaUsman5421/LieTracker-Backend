const express = require('express');
const Screenshot = require('../models/Screenshot');
const TrackingEntry = require('../models/TrackingEntry');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { withCachedSummary } = require('../services/summaryCache');
const { getDateRangeForRecentDays, getStartOfMonth } = require('../utils/date');
const {
  buildResolvedActiveDurationExpression,
  buildResolvedInactiveDurationExpression,
  buildUserAggregationKey,
} = require('../utils/tracking');

const router = express.Router();

router.use(requireDashboardAuthenticatedAdmin);

router.get('/summary', async (req, res) => {
  try {
    const summary = await withCachedSummary(`dashboard-summary:${req.adminId}`, async () => {
      const { todayStart, yesterdayStart, weekStart, rangeEnd } = getDateRangeForRecentDays(7);
      const monthStart = getStartOfMonth(new Date());
      const summaryStart = monthStart < weekStart ? monthStart : weekStart;
      const resolvedActiveDuration = buildResolvedActiveDurationExpression();
      const resolvedInactiveDuration = buildResolvedInactiveDurationExpression();
      const [trackingSummary, screenshotCounts] = await Promise.all([
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
      ]);

      const screenshotCountByUserId = new Map(
        screenshotCounts.map((item) => [String(item.userId || '').trim(), Number(item.screenshotCountToday) || 0])
      );

      const userSummary = trackingSummary.map((entry) => ({
        ...entry,
        screenshotCountToday: screenshotCountByUserId.get(String(entry.userId || '').trim()) || 0,
      }));

      return {
        generatedAt: new Date().toISOString(),
        userSummary,
      };
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[Backend] Get dashboard summary error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch dashboard summary' });
  }
});

module.exports = router;
