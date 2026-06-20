const express = require('express');
const Screenshot = require('../models/Screenshot');
const TrackingEntry = require('../models/TrackingEntry');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { withCachedSummary } = require('../services/summaryCache');
const { getDateRangeForRecentDays } = require('../utils/date');
const {
  buildResolvedActiveDurationExpression,
  buildResolvedInactiveDurationExpression,
  buildUserAggregationKey,
} = require('../utils/tracking');

const router = express.Router();

router.use(requireDashboardAuthenticatedAdmin);

router.get('/summary', async (req, res) => {
  try {
    const summary = await withCachedSummary('dashboard-summary', async () => {
      const { todayStart, yesterdayStart, weekStart, rangeEnd } = getDateRangeForRecentDays(7);
      const resolvedActiveDuration = buildResolvedActiveDurationExpression();
      const resolvedInactiveDuration = buildResolvedInactiveDurationExpression();
      const [trackingSummary, screenshotCounts] = await Promise.all([
        TrackingEntry.aggregate([
          {
            $match: {
              timestamp: {
                $gte: weekStart,
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
              last7Days: { $sum: { $ifNull: ['$duration', 0] } },
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
              activeToday: 1,
              inactiveToday: 1,
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
