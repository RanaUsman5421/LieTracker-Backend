const Admin = require('../models/Admin');
const Screenshot = require('../models/Screenshot');
const TrackingEntry = require('../models/TrackingEntry');
const User = require('../models/User');
const {
  DASHBOARD_ADMIN_PASSWORD,
  DASHBOARD_ADMIN_USERNAME,
} = require('../config/constants');

function getDefaultAdminEmail() {
  const normalizedUsername = String(DASHBOARD_ADMIN_USERNAME || 'admin')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'admin';

  return `${normalizedUsername}@lietracker.local`;
}

async function ensureDefaultAdmin() {
  const username = String(DASHBOARD_ADMIN_USERNAME || '').trim() || 'MonitaskAdmin';
  const email = getDefaultAdminEmail();
  let admin = await Admin.findOne({
    $or: [
      { username },
      { email },
    ],
  });

  if (!admin) {
    admin = await Admin.create({
      name: 'Default Admin',
      username,
      email,
      password: String(DASHBOARD_ADMIN_PASSWORD || 'AdminMonitask'),
    });
    console.log('[Backend] Created default dashboard admin for existing data');
  }

  return admin;
}

async function dropLegacyUserUniqueIndexes() {
  try {
    const indexes = await User.collection.indexes();
    const legacyUniqueIndexes = indexes.filter((index) => {
      const keys = Object.keys(index.key || {});
      return index.unique && keys.length === 1 && ['email', 'username'].includes(keys[0]);
    });

    for (const index of legacyUniqueIndexes) {
      await User.collection.dropIndex(index.name);
      console.log(`[Backend] Dropped legacy user unique index: ${index.name}`);
    }
  } catch (error) {
    console.warn('[Backend] Unable to inspect/drop legacy user indexes:', error.message || error);
  }
}

async function backfillExistingDataToDefaultAdmin() {
  const admin = await ensureDefaultAdmin();
  const missingAdminQuery = {
    $or: [
      { adminId: { $exists: false } },
      { adminId: null },
    ],
  };

  const users = await User.updateMany(missingAdminQuery, { $set: { adminId: admin._id } });

  await dropLegacyUserUniqueIndexes();

  console.log('[Backend] Default admin user backfill complete', {
    adminId: String(admin._id),
    users: users.modifiedCount || 0,
  });

  setImmediate(async () => {
    try {
      const [trackingEntries, screenshots] = await Promise.all([
        TrackingEntry.updateMany(missingAdminQuery, { $set: { adminId: admin._id } }),
        Screenshot.updateMany(missingAdminQuery, { $set: { adminId: admin._id } }),
      ]);

      await Promise.allSettled([
        Admin.createIndexes(),
        User.createIndexes(),
        TrackingEntry.createIndexes(),
        Screenshot.createIndexes(),
      ]);

      console.log('[Backend] Admin tracking/screenshot backfill complete', {
        adminId: String(admin._id),
        trackingEntries: trackingEntries.modifiedCount || 0,
        screenshots: screenshots.modifiedCount || 0,
      });
    } catch (error) {
      console.error('[Backend] Admin tracking/screenshot backfill failed:', error);
    }
  });

  return admin;
}

module.exports = {
  backfillExistingDataToDefaultAdmin,
  ensureDefaultAdmin,
};
