const Admin = require('../models/Admin');
const Screenshot = require('../models/Screenshot');
const TrackingEntry = require('../models/TrackingEntry');
const User = require('../models/User');
const {
  DASHBOARD_ADMIN_PASSWORD,
  DASHBOARD_ADMIN_USERNAME,
} = require('../config/constants');
const {
  getAssignableCloudinaryAccounts,
} = require('./cloudinaryAccounts');
const {
  cacheUserCloudinaryAccount,
} = require('./cloudinaryAssignment');

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

async function backfillTopCloudinaryAssignments(adminId, limit = 15) {
  const accounts = getAssignableCloudinaryAccounts();
  const assignableAccounts = accounts.filter((account) => account.key !== 'legacy');

  if (!assignableAccounts.length) {
    console.warn('[Backend] No assignable Cloudinary accounts were configured; skipping user binding backfill');
    return;
  }

  const rankedUsers = await TrackingEntry.aggregate([
    {
      $match: {
        adminId,
        userId: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$userId',
        totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
        latestTimestamp: { $max: '$timestamp' },
      },
    },
    {
      $sort: {
        totalDuration: -1,
        latestTimestamp: -1,
        _id: 1,
      },
    },
    {
      $limit: limit,
    },
  ]);

  if (!rankedUsers.length) {
    console.log('[Backend] No tracked users found for Cloudinary assignment backfill');
    return;
  }

  const rankedUserIds = rankedUsers.map((entry) => entry._id).filter(Boolean);
  const targetUsers = await User.find({
    _id: { $in: rankedUserIds },
    adminId,
  }).select('_id cloudinaryAccountKey').lean();

  const targetUserById = new Map(targetUsers.map((user) => [String(user._id), user]));
  let updatedCount = 0;

  for (let index = 0; index < rankedUserIds.length; index += 1) {
    const userId = String(rankedUserIds[index]);
    const account = assignableAccounts[index % assignableAccounts.length];
    const existingUser = targetUserById.get(userId);

    if (!existingUser) {
      continue;
    }

    await User.updateOne(
      { _id: existingUser._id, adminId },
      { $set: { cloudinaryAccountKey: account.key } }
    );
    cacheUserCloudinaryAccount(existingUser._id, account.key);
    updatedCount += 1;
  }

  console.log('[Backend] Cloudinary assignment backfill complete', {
    adminId: String(adminId),
    updatedCount,
    userCount: rankedUserIds.length,
    accountKeys: assignableAccounts.map((account) => account.key),
  });
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

  setImmediate(async () => {
    try {
      await backfillTopCloudinaryAssignments(admin._id, 15);
    } catch (error) {
      console.error('[Backend] Cloudinary assignment backfill failed:', error);
    }
  });

  return admin;
}

module.exports = {
  backfillExistingDataToDefaultAdmin,
  ensureDefaultAdmin,
};
