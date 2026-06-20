const TrackingEntry = require('../../models/TrackingEntry');
const User = require('../../models/User');
const { PerformanceCalculator } = require('../performance/PerformanceCalculator');
const {
  buildResolvedActiveDurationExpression,
  buildResolvedInactiveDurationExpression,
  buildUserLookupQuery,
  buildUserScopedQuery,
} = require('../../utils/tracking');
const { buildNamedRanges, buildSelectedRange } = require('./dateRanges');

const PERIOD_ORDER = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'this6Months',
  'last6Months',
  'complete',
];

function buildRangeMatch(baseQuery, range) {
  if (!range?.start || !range?.end) {
    return baseQuery;
  }

  return {
    ...baseQuery,
    timestamp: {
      $gte: range.start,
      $lt: range.end,
    },
  };
}

function buildPeriodFacet(baseQuery, ranges) {
  const resolvedActiveDuration = buildResolvedActiveDurationExpression();
  const resolvedInactiveDuration = buildResolvedInactiveDurationExpression();
  const periodKeys = ranges.selectedRange ? [...PERIOD_ORDER, 'selectedRange'] : PERIOD_ORDER;

  return periodKeys.reduce((facet, periodKey) => {
    facet[periodKey] = [
      { $match: buildRangeMatch(baseQuery, ranges[periodKey]) },
      {
        $group: {
          _id: null,
          totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
          activeDuration: { $sum: resolvedActiveDuration },
          inactiveDuration: { $sum: resolvedInactiveDuration },
          keystrokes: { $sum: { $ifNull: ['$keystrokes', 0] } },
          mouseClicks: { $sum: { $ifNull: ['$mouseClicks', 0] } },
          mouseMovements: { $sum: { $ifNull: ['$mouseMovements', 0] } },
          activityEvents: { $sum: { $ifNull: ['$activityEvents', 0] } },
          averageProductivityScore: { $avg: { $ifNull: ['$productivityScore', 0] } },
          entries: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          totalDuration: 1,
          activeDuration: 1,
          inactiveDuration: 1,
          keystrokes: 1,
          mouseClicks: 1,
          mouseMovements: 1,
          activityEvents: 1,
          averageProductivityScore: { $round: ['$averageProductivityScore', 2] },
          entries: 1,
        },
      },
    ];

    return facet;
  }, {});
}

function createEmptyTotals() {
  return {
    totalDuration: 0,
    activeDuration: 0,
    inactiveDuration: 0,
    keystrokes: 0,
    mouseClicks: 0,
    mouseMovements: 0,
    activityEvents: 0,
    averageProductivityScore: 0,
    entries: 0,
  };
}

function finalizePeriodSummary(identifier, periodKey, range, aggregateResult) {
  const totals = aggregateResult || createEmptyTotals();
  const trackedDuration = Number(totals.activeDuration || 0) + Number(totals.inactiveDuration || 0);
  const totalDuration = Number(totals.totalDuration || 0);
  const activeDuration = Number(totals.activeDuration || 0);
  const inactiveDuration = Number(totals.inactiveDuration || 0);
  const activityEvents = Number(totals.activityEvents || 0);
  const activityPercent = trackedDuration > 0 ? (activeDuration / trackedDuration) * 100 : 0;
  const activityFrequency = activeDuration > 0 ? activityEvents / (activeDuration / 60000) : 0;

  const calculator = new PerformanceCalculator();
  const performance = calculator.calculate({
    userId: identifier,
    activityPercent,
    productiveTime: activeDuration,
    unproductiveTime: inactiveDuration,
    totalTime: totalDuration,
    idleTime: inactiveDuration,
  });

  return {
    key: periodKey,
    start: range?.start ? range.start.toISOString() : null,
    end: range?.end ? range.end.toISOString() : null,
    summary: {
      totalDuration,
      activeDuration,
      inactiveDuration,
      keystrokes: Number(totals.keystrokes || 0),
      mouseClicks: Number(totals.mouseClicks || 0),
      mouseMovements: Number(totals.mouseMovements || 0),
      activityEvents,
      averageProductivityScore: Number(totals.averageProductivityScore || 0),
      entries: Number(totals.entries || 0),
      activeRatio: Number(activityPercent.toFixed(2)),
      activityFrequency: Number(activityFrequency.toFixed(2)),
    },
    performance,
  };
}

async function getUserPeriodSummary(identifier) {
  return getUserPeriodSummaryWithOptions(identifier, {});
}

async function getUserPeriodSummaryWithOptions(identifier, options = {}) {
  const ranges = buildNamedRanges(new Date());
  const selectedRange = buildSelectedRange(options);

  if (selectedRange) {
    ranges.selectedRange = selectedRange;
  }

  const userQuery = buildUserScopedQuery(identifier);
  const lookupQuery = buildUserLookupQuery({
    userId: identifier,
    userEmail: identifier,
  });

  const [user, aggregates] = await Promise.all([
    User.findOne(lookupQuery)
      .select('_id username email department designation createdAt lastSeenAt lastScreenshotAt')
      .lean(),
    TrackingEntry.aggregate([
      {
        $facet: buildPeriodFacet(userQuery, ranges),
      },
    ]),
  ]);

  const aggregateBuckets = aggregates[0] || {};
  const normalizedIdentifier = String(identifier || '').trim();
  const periods = PERIOD_ORDER.reduce((result, periodKey) => {
    result[periodKey] = finalizePeriodSummary(
      normalizedIdentifier,
      periodKey,
      ranges[periodKey],
      aggregateBuckets[periodKey]?.[0]
    );
    return result;
  }, {});

  if (selectedRange) {
    periods.selectedRange = finalizePeriodSummary(
      normalizedIdentifier,
      'selectedRange',
      selectedRange,
      aggregateBuckets.selectedRange?.[0]
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    user: user
      ? {
        id: user._id,
        username: user.username,
        email: user.email,
        department: user.department,
        designation: user.designation,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
        lastScreenshotAt: user.lastScreenshotAt,
      }
      : null,
    periods,
  };
}

module.exports = {
  PERIOD_ORDER,
  getUserPeriodSummary,
  getUserPeriodSummaryWithOptions,
};
