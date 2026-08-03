const express = require('express');
const Screenshot = require('../models/Screenshot');
const TrackingEntry = require('../models/TrackingEntry');
const User = require('../models/User');
const { requireAuthenticatedUser } = require('../middleware/requireAuth');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { clearSummaryCache, withCachedSummary } = require('../services/summaryCache');
const { normalizeIdentifier, clampNumber, getPaginationParams } = require('../utils/common');
const { TRACKING_TIME_ZONE, getDateRangeForRecentDays, getDateBoundsFromQuery, getDayKey } = require('../utils/date');
const {
  buildResolvedActiveDurationExpression,
  buildResolvedInactiveDurationExpression,
  buildUserScopedQuery,
  buildUserLookupQuery,
} = require('../utils/tracking');
const { getUserPresence, ONLINE_WINDOW_MS } = require('../utils/presence');

const router = express.Router();
const SCREENSHOT_SEGMENT_MS = 15 * 60 * 1000;
const EXPECTED_EVENTS_PER_SEGMENT = 15;
const trackingWriteRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 240,
  message: 'Too many tracking write requests. Please try again shortly.',
});

function normalizeTimelineDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveEntryDurations(entry) {
  const duration = Math.max(0, Number(entry?.duration) || 0);
  let activeDuration = Math.max(0, Number(entry?.activeDuration) || 0);
  let inactiveDuration = Math.max(0, Number(entry?.inactiveDuration) || 0);

  if (activeDuration === 0 && inactiveDuration === 0 && duration > 0) {
    if (entry?.classification === 'idle') {
      inactiveDuration = duration;
    } else {
      activeDuration = duration;
    }
  }

  if (activeDuration + inactiveDuration > duration) {
    const overflow = activeDuration + inactiveDuration - duration;
    inactiveDuration = Math.max(0, inactiveDuration - overflow);
  }

  return {
    duration,
    activeDuration,
    inactiveDuration,
    keystrokes: Math.max(0, Number(entry?.keystrokes) || 0),
    mouseClicks: Math.max(0, Number(entry?.mouseClicks) || 0),
    mouseMovements: Math.max(0, Number(entry?.mouseMovements) || 0),
    activityEvents: Math.max(0, Number(entry?.activityEvents) || 0),
  };
}

function calculateSegmentMetrics(trackingEntries, segmentStart, segmentEnd) {
  const segmentStartMs = segmentStart.getTime();
  const segmentEndMs = segmentEnd.getTime();

  return trackingEntries.reduce(
    (totals, entry) => {
      const startedAt = normalizeTimelineDate(entry.timestamp);
      if (!startedAt) {
        return totals;
      }

      const entryMetrics = resolveEntryDurations(entry);
      const entryStartMs = startedAt.getTime();
      const entryEndMs = entryStartMs + entryMetrics.duration;
      const overlapMs = Math.max(
        0,
        Math.min(entryEndMs, segmentEndMs) - Math.max(entryStartMs, segmentStartMs)
      );

      if (!overlapMs) {
        return totals;
      }

      const ratio = entryMetrics.duration > 0 ? overlapMs / entryMetrics.duration : 1;
      totals.duration += overlapMs;
      totals.activeDuration += entryMetrics.activeDuration * ratio;
      totals.inactiveDuration += entryMetrics.inactiveDuration * ratio;
      totals.keystrokes += entryMetrics.keystrokes * ratio;
      totals.mouseClicks += entryMetrics.mouseClicks * ratio;
      totals.mouseMovements += entryMetrics.mouseMovements * ratio;
      totals.activityEvents += entryMetrics.activityEvents * ratio;
      return totals;
    },
    {
      duration: 0,
      activeDuration: 0,
      inactiveDuration: 0,
      keystrokes: 0,
      mouseClicks: 0,
      mouseMovements: 0,
      activityEvents: 0,
    }
  );
}

function roundSegmentMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      Math.round((Number(value) || 0) * 100) / 100,
    ])
  );
}

function addSegmentActivityMetrics(metrics) {
  const safeMetrics = metrics || {};
  const activeDuration = Math.max(0, Number(safeMetrics.activeDuration) || 0);
  const inactiveDuration = Math.max(0, Number(safeMetrics.inactiveDuration) || 0);
  const trackedDuration = activeDuration + inactiveDuration;
  const activityEvents = Math.max(0, Number(safeMetrics.activityEvents) || 0);
  const activeTimeScore = trackedDuration > 0 ? (activeDuration / trackedDuration) * 100 : 0;
  const inputEventScore = Math.min(100, (activityEvents / EXPECTED_EVENTS_PER_SEGMENT) * 100);
  const performanceScore = (activeTimeScore * inputEventScore) / 100;

  return roundSegmentMetrics({
    ...safeMetrics,
    expectedActivityEvents: EXPECTED_EVENTS_PER_SEGMENT,
    activeTimeScore,
    inputEventScore,
    performanceScore,
  });
}

function buildPresenceSessions({ trackingEntries, screenshots, rangeStart, rangeEnd }) {
  const events = [
    ...trackingEntries.map((entry) => {
      const startedAt = normalizeTimelineDate(entry.timestamp);
      if (!startedAt) {
        return null;
      }

      const duration = Math.max(0, Number(entry.duration) || 0);
      return {
        startedAt,
        endedAt: new Date(startedAt.getTime() + duration),
      };
    }),
    ...screenshots.map((screenshot) => {
      const timestamp = normalizeTimelineDate(screenshot.timestamp);
      return timestamp
        ? {
          startedAt: timestamp,
          endedAt: timestamp,
        }
        : null;
    }),
  ]
    .filter(Boolean)
    .sort((first, second) => first.startedAt - second.startedAt);

  if (!events.length) {
    return [];
  }

  const onlineSessions = [];

  events.forEach((event) => {
    const activeSession = onlineSessions[onlineSessions.length - 1];

    if (
      activeSession &&
      event.startedAt.getTime() - activeSession.lastActivityAt.getTime() <= ONLINE_WINDOW_MS
    ) {
      if (event.endedAt > activeSession.lastActivityAt) {
        activeSession.lastActivityAt = event.endedAt;
      }
      return;
    }

    onlineSessions.push({
      status: 'online',
      startedAt: event.startedAt,
      lastActivityAt: event.endedAt,
    });
  });

  const sessions = [];

  onlineSessions.forEach((session, index) => {
    const startedAt = new Date(Math.max(session.startedAt.getTime(), rangeStart.getTime()));
    const endedAt = new Date(Math.min(session.lastActivityAt.getTime() + ONLINE_WINDOW_MS, rangeEnd.getTime()));

    if (startedAt < endedAt) {
      let segmentIndex = 1;
      let segmentStartedAt = startedAt;

      while (segmentStartedAt < endedAt) {
        const segmentEndedAt = new Date(
          Math.min(segmentStartedAt.getTime() + SCREENSHOT_SEGMENT_MS, endedAt.getTime())
        );
        const isCompleteSegment =
          segmentEndedAt.getTime() - segmentStartedAt.getTime() >= SCREENSHOT_SEGMENT_MS &&
          segmentEndedAt.getTime() <= Date.now();
        const metrics = calculateSegmentMetrics(trackingEntries, segmentStartedAt, segmentEndedAt);

        sessions.push({
          id: `online-${index + 1}-segment-${segmentIndex}`,
          status: 'online',
          startedAt: segmentStartedAt.toISOString(),
          endedAt: segmentEndedAt.toISOString(),
          segmentDurationMs: SCREENSHOT_SEGMENT_MS,
          isCompleteSegment,
          metrics: addSegmentActivityMetrics(metrics),
        });

        segmentStartedAt = segmentEndedAt;
        segmentIndex += 1;
      }
    }

    const nextSession = onlineSessions[index + 1];
    if (!nextSession) {
      return;
    }

    const offlineStartedAt = endedAt;
    const offlineEndedAt = new Date(Math.min(nextSession.startedAt.getTime(), rangeEnd.getTime()));

    if (offlineStartedAt < offlineEndedAt) {
      sessions.push({
        id: `offline-${index + 1}`,
        status: 'offline',
        startedAt: offlineStartedAt.toISOString(),
        endedAt: offlineEndedAt.toISOString(),
      });
    }
  });

  return sessions;
}

router.post('/', trackingWriteRateLimit, requireAuthenticatedUser, async (req, res) => {
  try {
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!entries.length) {
      return res.status(400).json({ success: false, message: 'No tracking entries provided' });
    }

    const authUser = req.authUser;
    const requestUserEmail = authUser?.email
      ? String(authUser.email).toLowerCase()
      : normalizeIdentifier(req.body.userEmail) || 'unknown';
    const requestUserId = String(
      authUser?._id
        || req.body.userId
        || entries.find((entry) => entry?.userId)?.userId
        || ''
    ).trim();

    const resolvedUser = authUser || await User.findOne(buildUserLookupQuery({
      userId: requestUserId,
      userEmail: requestUserEmail,
    }))
      .select('_id email')
      .lean();
    const resolvedAdminId = resolvedUser?.adminId || authUser?.adminId || null;

    const mappedEntries = entries.map((entry) => {
      const duration = Math.max(0, Number(entry.duration) || 0);
      const classification = entry.classification === 'idle' ? 'idle' : 'active';
      let activeDuration = Math.max(0, Number(entry.activeDuration) || 0);
      let inactiveDuration = Math.max(0, Number(entry.inactiveDuration) || 0);

      if (activeDuration === 0 && inactiveDuration === 0 && duration > 0) {
        if (classification === 'idle') {
          inactiveDuration = duration;
        } else {
          activeDuration = duration;
        }
      }

      if (activeDuration + inactiveDuration > duration) {
        const overflow = activeDuration + inactiveDuration - duration;
        inactiveDuration = Math.max(0, inactiveDuration - overflow);
      }

      const trackedDuration = activeDuration + inactiveDuration;
      const productivityScore = trackedDuration
        ? Number(((activeDuration / trackedDuration) * 100).toFixed(2))
        : Math.max(0, Number(entry.productivityScore) || 0);

      return {
        adminId: resolvedAdminId,
        userId: resolvedUser?._id || null,
        deviceId: String(entry.deviceId || 'unknown-device').trim() || 'unknown-device',
        app: entry.app || 'Unknown',
        title: entry.title || 'No title',
        url: entry.url ? String(entry.url).trim() : null,
        duration,
        activeDuration,
        inactiveDuration,
        keystrokes: Math.max(0, Number(entry.keystrokes) || 0),
        mouseClicks: Math.max(0, Number(entry.mouseClicks) || 0),
        mouseMovements: Math.max(0, Number(entry.mouseMovements) || 0),
        activityEvents: Math.max(0, Number(entry.activityEvents) || 0),
        activityFrequency: Math.max(0, Number(entry.activityFrequency) || 0),
        productivityScore,
        classification,
        sessionId: entry.sessionId ? String(entry.sessionId).trim() : null,
        userEmail: resolvedUser?.email || requestUserEmail,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
      };
    });

    const saved = await TrackingEntry.insertMany(mappedEntries);
    clearSummaryCache();
    if (resolvedUser?._id) {
      await User.findByIdAndUpdate(resolvedUser._id, { lastSeenAt: new Date() });
    }
    res.json({ success: true, inserted: saved.length });
  } catch (error) {
    console.error('[Backend] Tracking save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save tracking data' });
  }
});

router.get('/', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query, {
      page: 1,
      limit: 200,
      maxLimit: 1000,
    });
    const [entries, total] = await Promise.all([
      TrackingEntry.find({ adminId: req.adminId })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      TrackingEntry.countDocuments({ adminId: req.adminId }),
    ]);
    res.json({
      success: true,
      data: entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('[Backend] Get tracking error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch tracking data' });
  }
});

router.get('/user/:identifier', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query, {
      page: 1,
      limit: 250,
      maxLimit: 1000,
    });
    const userQuery = buildUserScopedQuery(req.params.identifier, req.adminId);
    const [entries, total] = await Promise.all([
      TrackingEntry.find(userQuery)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      TrackingEntry.countDocuments(userQuery),
    ]);
    res.json({
      success: true,
      data: entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('[Backend] Get user tracking error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch user tracking data' });
  }
});

router.get('/user/:identifier/presence-sessions', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : getDayKey(new Date());
    const { start, end } = getDateBoundsFromQuery(date);
    const userQuery = buildUserScopedQuery(req.params.identifier, req.adminId);
    const matchedUser = await User.findOne(buildUserLookupQuery({
      userId: req.params.identifier,
      userEmail: req.params.identifier,
      adminId: req.adminId,
    }))
      .select('_id email')
      .lean();

    const [trackingEntries, screenshots] = await Promise.all([
      TrackingEntry.find({
        ...userQuery,
        timestamp: { $gte: start, $lt: end },
      })
        .select('timestamp duration activeDuration inactiveDuration classification keystrokes mouseClicks mouseMovements activityEvents')
        .sort({ timestamp: 1 })
        .lean(),
      matchedUser?._id
        ? Screenshot.find({
          adminId: req.adminId,
          userId: String(matchedUser._id),
          timestamp: { $gte: start, $lt: end },
        })
          .select('timestamp')
          .sort({ timestamp: 1 })
          .lean()
        : [],
    ]);

    res.json({
      success: true,
      data: {
        date,
        offlineAfterMs: ONLINE_WINDOW_MS,
        sessions: buildPresenceSessions({
          trackingEntries,
          screenshots,
          rangeStart: start,
          rangeEnd: end,
        }),
      },
    });
  } catch (error) {
    console.error('[Backend] Get user presence sessions error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch user presence sessions' });
  }
});

router.post('/manual', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const {
      userId,
      userEmail,
      fromTime,
      toTime,
      date,
      project,
      task,
      taskName,
    } = req.body || {};

    const normalizedUserEmail = normalizeIdentifier(userEmail);
    const normalizedTaskName = String(taskName || '').trim();
    const normalizedProject = String(project || '').trim() || 'Default';
    const normalizedTask = String(task || '').trim() || 'Add New';

    if ((!userId || !String(userId).trim()) && !normalizedUserEmail) {
      return res.status(400).json({ success: false, message: 'A valid user is required.' });
    }

    if (!date || !fromTime || !toTime || !normalizedTaskName) {
      return res.status(400).json({ success: false, message: 'Date, time range, and task name are required.' });
    }

    const startedAt = new Date(`${date}T${fromTime}:00`);
    const endedAt = new Date(`${date}T${toTime}:00`);

    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt <= startedAt) {
      return res.status(400).json({ success: false, message: 'Please provide a valid manual time range.' });
    }

    const duration = endedAt.getTime() - startedAt.getTime();
    const user = await User.findOne(buildUserLookupQuery({
      userId,
      userEmail: normalizedUserEmail,
      adminId: req.adminId,
    })).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found for manual time entry.' });
    }

    const manualEntry = await TrackingEntry.create({
      adminId: req.adminId,
      userId: user._id,
      deviceId: 'manual-entry',
      app: normalizedProject,
      title: `${normalizedTask}: ${normalizedTaskName}`,
      url: null,
      duration,
      activeDuration: duration,
      inactiveDuration: 0,
      keystrokes: 0,
      mouseClicks: 0,
      mouseMovements: 0,
      activityEvents: 0,
      activityFrequency: 0,
      productivityScore: 100,
      classification: 'active',
      sessionId: 'manual-entry',
      userEmail: user.email,
      timestamp: startedAt,
    });

    clearSummaryCache();
    await User.findByIdAndUpdate(user._id, { lastSeenAt: new Date() });

    res.status(201).json({
      success: true,
      data: {
        id: manualEntry._id,
        userId: manualEntry.userId,
        userEmail: manualEntry.userEmail,
        duration: manualEntry.duration,
        activeDuration: manualEntry.activeDuration,
        date,
        fromTime,
        toTime,
        project: normalizedProject,
        task: normalizedTask,
        taskName: normalizedTaskName,
      },
    });
  } catch (error) {
    console.error('[Backend] Manual tracking save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save manual time' });
  }
});

router.get('/user/:identifier/summary', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const days = clampNumber(req.query.days, { minimum: 7, maximum: 90, fallback: 31 });
    const cacheKey = `user-summary:${req.adminId}:${req.params.identifier}:${days}`;
    const summary = await withCachedSummary(cacheKey, async () => {
      const userQuery = buildUserScopedQuery(req.params.identifier, req.adminId);
      const range = getDateRangeForRecentDays(days);
      const resolvedActiveDuration = buildResolvedActiveDurationExpression();
      const resolvedInactiveDuration = buildResolvedInactiveDurationExpression();

      const [matchedUser, daySummaries, latestEntry] = await Promise.all([
        User.findOne(buildUserLookupQuery({
          userId: req.params.identifier,
          userEmail: req.params.identifier,
          adminId: req.adminId,
        }))
          .select('_id email username createdAt lastSeenAt lastScreenshotAt')
          .lean(),
        TrackingEntry.aggregate([
          {
            $match: {
              adminId: req.adminId,
              ...userQuery,
              timestamp: {
                $gte: range.rangeStart,
                $lt: range.rangeEnd,
              },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$timestamp',
                  timezone: TRACKING_TIME_ZONE,
                },
              },
              duration: { $sum: { $ifNull: ['$duration', 0] } },
              activeDuration: { $sum: resolvedActiveDuration },
              inactiveDuration: { $sum: resolvedInactiveDuration },
              keystrokes: { $sum: { $ifNull: ['$keystrokes', 0] } },
              mouseClicks: { $sum: { $ifNull: ['$mouseClicks', 0] } },
              mouseMovements: { $sum: { $ifNull: ['$mouseMovements', 0] } },
              activityEvents: { $sum: { $ifNull: ['$activityEvents', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              dayKey: '$_id',
              duration: 1,
              activeDuration: 1,
              inactiveDuration: 1,
              keystrokes: 1,
              mouseClicks: 1,
              mouseMovements: 1,
              activityEvents: 1,
            },
          },
          { $sort: { dayKey: 1 } },
        ]),
        TrackingEntry.findOne(userQuery)
          .sort({ timestamp: -1 })
          .select('timestamp classification')
          .lean(),
      ]);

      const screenshotCounts = matchedUser?._id
        ? await Screenshot.aggregate([
          {
            $match: {
              adminId: req.adminId,
              userId: String(matchedUser._id),
              timestamp: {
                $gte: range.rangeStart,
                $lt: range.rangeEnd,
              },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$timestamp',
                  timezone: TRACKING_TIME_ZONE,
                },
              },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              dayKey: '$_id',
              count: 1,
            },
          },
        ])
        : [];

      const screenshotCountByDay = new Map(
        screenshotCounts.map((item) => [item.dayKey, item.count])
      );

      return {
        generatedAt: new Date().toISOString(),
        latestDayKey: latestEntry?.timestamp ? getDayKey(latestEntry.timestamp) : null,
        latestClassification: latestEntry?.classification === 'idle' ? 'idle' : 'active',
        user: matchedUser
          ? {
            id: matchedUser._id,
            username: matchedUser.username,
            email: matchedUser.email,
            createdAt: matchedUser.createdAt,
            lastSeenAt: matchedUser.lastSeenAt,
            lastScreenshotAt: matchedUser.lastScreenshotAt,
            presence: getUserPresence(matchedUser),
          }
          : null,
        daySummaries: daySummaries.map((item) => ({
          ...item,
          screenshotCount: screenshotCountByDay.get(item.dayKey) || 0,
        })),
      };
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[Backend] Get user tracking summary error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch user tracking summary' });
  }
});

router.get('/user/:identifier/activity', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const limit = clampNumber(req.query.limit, { minimum: 1, maximum: 25, fallback: 7 });
    const date = req.query.date ? String(req.query.date) : getDayKey(new Date());
    const { start, end } = getDateBoundsFromQuery(date);
    const cacheKey = `user-activity:${req.adminId}:${req.params.identifier}:${date}:${limit}`;
    const activity = await withCachedSummary(cacheKey, async () => {
      const userQuery = buildUserScopedQuery(req.params.identifier, req.adminId);
      const matchStage = {
        ...userQuery,
        timestamp: { $gte: start, $lt: end },
      };

      const [applications, internetUsage] = await Promise.all([
        TrackingEntry.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$app',
              duration: { $sum: { $ifNull: ['$duration', 0] } },
            },
          },
          { $sort: { duration: -1, _id: 1 } },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              name: { $ifNull: ['$_id', 'Unknown'] },
              duration: 1,
            },
          },
        ]),
        TrackingEntry.aggregate([
          {
            $match: {
              ...matchStage,
              url: { $type: 'string', $ne: '' },
            },
          },
          {
            $group: {
              _id: '$url',
              duration: { $sum: { $ifNull: ['$duration', 0] } },
            },
          },
          { $sort: { duration: -1, _id: 1 } },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              name: '$_id',
              duration: 1,
            },
          },
        ]),
      ]);

      return {
        generatedAt: new Date().toISOString(),
        date,
        applications,
        internetUsage,
      };
    });

    res.json({ success: true, data: activity });
  } catch (error) {
    console.error('[Backend] Get user activity breakdown error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch user activity breakdown' });
  }
});

router.get('/summary', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const summary = await withCachedSummary(`tracking-summary:${req.adminId}`, async () => {
      const resolvedActiveDuration = buildResolvedActiveDurationExpression();
      const resolvedInactiveDuration = buildResolvedInactiveDurationExpression();

      const userSummary = await TrackingEntry.aggregate([
        {
          $match: {
            adminId: req.adminId,
          },
        },
        {
          $group: {
            _id: '$userEmail',
            totalDuration: { $sum: '$duration' },
            activeDuration: { $sum: resolvedActiveDuration },
            inactiveDuration: { $sum: resolvedInactiveDuration },
            keystrokes: { $sum: '$keystrokes' },
            mouseClicks: { $sum: '$mouseClicks' },
            mouseMovements: { $sum: '$mouseMovements' },
            activityEvents: { $sum: '$activityEvents' },
            entries: { $sum: 1 },
          },
        },
        {
          $project: {
            userEmail: '$_id',
            totalDuration: 1,
            activeDuration: 1,
            inactiveDuration: 1,
            keystrokes: 1,
            mouseClicks: 1,
            mouseMovements: 1,
            activityEvents: 1,
            entries: 1,
            _id: 0,
          },
        },
        { $sort: { totalDuration: -1 } },
      ]);

      const appSummary = await TrackingEntry.aggregate([
        {
          $match: {
            adminId: req.adminId,
          },
        },
        {
          $group: {
            _id: '$app',
            totalDuration: { $sum: '$duration' },
            activeDuration: { $sum: resolvedActiveDuration },
            inactiveDuration: { $sum: resolvedInactiveDuration },
            entries: { $sum: 1 },
          },
        },
        {
          $project: {
            app: '$_id',
            totalDuration: 1,
            activeDuration: 1,
            inactiveDuration: 1,
            entries: 1,
            _id: 0,
          },
        },
        { $sort: { totalDuration: -1 } },
      ]);

      return { userSummary, appSummary };
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[Backend] Get tracking summary error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch tracking summary' });
  }
});

module.exports = router;
