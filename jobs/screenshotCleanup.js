const cron = require('node-cron');
const Screenshot = require('../models/Screenshot');
const User = require('../models/User');
const { clearSummaryCache } = require('../services/summaryCache');
const {
  destroyCloudinaryAsset,
} = require('../services/cloudinaryStorage');
const {
  getDefaultCloudinaryAccountKey,
  getLegacyCloudinaryAccountKey,
  normalizeKey,
} = require('../services/cloudinaryAccounts');

const RETENTION_DAYS = 30;
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_SCHEDULE = '0 0 * * *';
const CLEANUP_TIMEZONE = process.env.SCREENSHOT_CLEANUP_TIMEZONE || 'Asia/Karachi';

let cleanupInProgress = false;

async function deleteCloudinaryImage(publicId, accountKey) {
  if (!publicId) {
    return;
  }

  const resolvedAccountKey =
    normalizeKey(accountKey) ||
    getLegacyCloudinaryAccountKey() ||
    getDefaultCloudinaryAccountKey();

  if (!resolvedAccountKey) {
    return;
  }

  await destroyCloudinaryAsset({
    publicId,
    accountKey: resolvedAccountKey,
    resourceType: 'image',
  });
}

async function updateUsersLastScreenshotAt(userIds) {
  await Promise.all(Array.from(userIds).map(async (userId) => {
    const latestScreenshot = await Screenshot.findOne({ userId })
      .sort({ timestamp: -1 })
      .select('timestamp')
      .lean();

    await User.findByIdAndUpdate(userId, {
      lastScreenshotAt: latestScreenshot?.timestamp || null,
    });
  }));
}

async function cleanupOldScreenshots() {
  if (cleanupInProgress) {
    console.log('[ScreenshotCleanup] Previous cleanup is still running; skipping this run');
    return;
  }

  cleanupInProgress = true;

  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;
    const affectedUserIds = new Set();
    const failedScreenshotIds = new Set();

    while (true) {
      const query = { timestamp: { $lt: cutoffDate } };

      if (failedScreenshotIds.size) {
        query._id = { $nin: Array.from(failedScreenshotIds) };
      }

      const oldScreenshots = await Screenshot.find(query)
        .select('_id userId publicId cloudinaryAccountKey timestamp')
        .sort({ timestamp: 1 })
        .limit(CLEANUP_BATCH_SIZE)
        .lean();

      if (!oldScreenshots.length) {
        break;
      }

      const deletableIds = [];

      for (const screenshot of oldScreenshots) {
        try {
          await deleteCloudinaryImage(screenshot.publicId, screenshot.cloudinaryAccountKey);
          deletableIds.push(screenshot._id);
          affectedUserIds.add(String(screenshot.userId));
        } catch (error) {
          console.error('[ScreenshotCleanup] Cloudinary delete failed:', {
            screenshotId: screenshot._id,
            publicId: screenshot.publicId,
            message: error.message || String(error),
          });
          failedScreenshotIds.add(String(screenshot._id));
        }
      }

      if (!deletableIds.length) {
        continue;
      }

      const deleteResult = await Screenshot.deleteMany({ _id: { $in: deletableIds } });
      totalDeleted += deleteResult.deletedCount || 0;

      if (oldScreenshots.length < CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    if (affectedUserIds.size) {
      await updateUsersLastScreenshotAt(affectedUserIds);
      clearSummaryCache();
    }

    console.log('[ScreenshotCleanup] Completed old screenshot cleanup:', {
      deletedCount: totalDeleted,
      cutoffDate: cutoffDate.toISOString(),
    });
  } catch (error) {
    console.error('[ScreenshotCleanup] Cleanup failed:', error);
  } finally {
    cleanupInProgress = false;
  }
}

function startScreenshotCleanupJob() {
  if (!cron.validate(CLEANUP_SCHEDULE)) {
    throw new Error(`Invalid screenshot cleanup schedule: ${CLEANUP_SCHEDULE}`);
  }

  cron.schedule(CLEANUP_SCHEDULE, cleanupOldScreenshots, {
    timezone: CLEANUP_TIMEZONE,
  });

  console.log(`[ScreenshotCleanup] Scheduled daily cleanup at 12:00 AM (${CLEANUP_TIMEZONE})`);
}

module.exports = {
  cleanupOldScreenshots,
  startScreenshotCleanupJob,
};
