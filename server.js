const { loadEnvironment } = require('./config/env');

loadEnvironment();

async function startServer() {
  try {
    const app = require('./app');
    const { getCloudinaryConfigStatus } = require('./config/cloudinary');
    const { PORT, HOST } = require('./config/constants');
    const { connectToDatabase } = require('./services/database');

    const cloudinaryConfigStatus = getCloudinaryConfigStatus();

    if (cloudinaryConfigStatus.missing.length) {
      console.error('[Backend] Cloudinary configuration missing:', cloudinaryConfigStatus.missing.join(', '));
    } else {
      console.log('[Backend] Cloudinary configuration loaded');
    }

    await connectToDatabase();

    app.listen(PORT, HOST, () => {
      console.log(`LieTracker Backend listening on ${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('[Backend] Fatal startup error:', error);
    process.exit(1);
  }
}

startServer();
