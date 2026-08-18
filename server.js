const { loadEnvironment } = require('./config/env');

loadEnvironment();

async function startServer() {
  try {
    const app = require('./app');
    const { PORT, HOST } = require('./config/constants');
    const { connectToDatabase } = require('./services/database');
    const { backfillExistingDataToDefaultAdmin } = require('./services/adminBootstrap');
    const { startScreenshotCleanupJob } = require('./jobs/screenshotCleanup');
    const { getCloudinaryAccountStatus } = require('./services/cloudinaryAccounts');

    const cloudinaryConfigStatus = getCloudinaryAccountStatus();

    if (!cloudinaryConfigStatus.assignableAccounts.length) {
      console.error('[Backend] No assignable Cloudinary accounts are configured');
    } else {
      console.log('[Backend] Cloudinary accounts loaded:', cloudinaryConfigStatus.assignableAccounts.map((account) => account.key).join(', '));
    }

    if (cloudinaryConfigStatus.missing.length) {
      console.warn('[Backend] Cloudinary accounts missing fields:', cloudinaryConfigStatus.missing.map((account) => `${account.key}:${account.missing.join('|')}`).join(', '));
    } else {
      console.log('[Backend] Cloudinary configuration loaded');
    }

    await connectToDatabase();
    await backfillExistingDataToDefaultAdmin();
    startScreenshotCleanupJob();

    app.listen(PORT, HOST, () => {
      console.log(`LieTracker Backend listening on ${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('[Backend] Fatal startup error:', error);
    process.exit(1);
  }
}

startServer();
