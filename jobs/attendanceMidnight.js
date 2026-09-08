const cron = require('node-cron');
const { TRACKING_TIME_ZONE, finalizeExpiredAttendance } = require('../services/attendance');

function startAttendanceMidnightJob() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const modified = await finalizeExpiredAttendance(new Date());
      console.log(`[Backend] Midnight attendance checkout completed (${modified} record(s))`);
    } catch (error) {
      console.error('[Backend] Midnight attendance checkout failed:', error);
    }
  }, { timezone: TRACKING_TIME_ZONE });
}

module.exports = { startAttendanceMidnightJob };
