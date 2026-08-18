const crypto = require('crypto');
const User = require('../models/User');
const {
  getCloudinaryAccountByKey,
  getCloudinaryAccountKeys,
  getDefaultCloudinaryAccountKey,
  isValidCloudinaryAccountKey,
  normalizeKey,
} = require('./cloudinaryAccounts');

const userCloudinaryAccountCache = new Map();

function normalizeUserId(userOrId) {
  if (!userOrId) {
    return '';
  }

  if (typeof userOrId === 'string' || typeof userOrId === 'number') {
    return normalizeKey(userOrId);
  }

  return normalizeKey(userOrId._id || userOrId.id);
}

function cacheUserCloudinaryAccount(userId, accountKey) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedAccountKey = normalizeKey(accountKey);

  if (!normalizedUserId || !normalizedAccountKey) {
    return null;
  }

  userCloudinaryAccountCache.set(normalizedUserId, {
    accountKey: normalizedAccountKey,
    cachedAt: Date.now(),
  });

  return normalizedAccountKey;
}

function clearUserCloudinaryAccountCache(userId) {
  const normalizedUserId = normalizeUserId(userId);

  if (normalizedUserId) {
    userCloudinaryAccountCache.delete(normalizedUserId);
  }
}

function getCachedUserCloudinaryAccount(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  const cached = userCloudinaryAccountCache.get(normalizedUserId);
  if (!cached) {
    return null;
  }

  if (!isValidCloudinaryAccountKey(cached.accountKey)) {
    userCloudinaryAccountCache.delete(normalizedUserId);
    return null;
  }

  return cached.accountKey;
}

function chooseCloudinaryAccountKeyForUserId(userId) {
  const availableKeys = getCloudinaryAccountKeys();
  if (!availableKeys.length) {
    return null;
  }

  if (availableKeys.length === 1) {
    return availableKeys[0];
  }

  const normalizedUserId = normalizeUserId(userId);
  const digest = crypto.createHash('sha1').update(normalizedUserId).digest();
  const bucket = digest.readUInt32BE(0);
  return availableKeys[bucket % availableKeys.length];
}

function getUserCloudinaryAccountKey(user) {
  const cachedAccountKey = getCachedUserCloudinaryAccount(user);
  if (cachedAccountKey) {
    return cachedAccountKey;
  }

  const existingAccountKey = normalizeKey(user?.cloudinaryAccountKey);
  if (existingAccountKey && isValidCloudinaryAccountKey(existingAccountKey)) {
    cacheUserCloudinaryAccount(user, existingAccountKey);
    return existingAccountKey;
  }

  return chooseCloudinaryAccountKeyForUserId(user);
}

async function ensureUserCloudinaryAccountKey(user, { persistIfMissing = false } = {}) {
  const userId = normalizeUserId(user);
  if (!userId) {
    return null;
  }

  const cachedAccountKey = getCachedUserCloudinaryAccount(userId);
  if (cachedAccountKey) {
    return cachedAccountKey;
  }

  const existingAccountKey = normalizeKey(user?.cloudinaryAccountKey);
  if (existingAccountKey && isValidCloudinaryAccountKey(existingAccountKey)) {
    cacheUserCloudinaryAccount(userId, existingAccountKey);
    return existingAccountKey;
  }

  const fallbackAccountKey = chooseCloudinaryAccountKeyForUserId(userId) || getDefaultCloudinaryAccountKey();
  if (!fallbackAccountKey) {
    return null;
  }

  user.cloudinaryAccountKey = fallbackAccountKey;
  cacheUserCloudinaryAccount(userId, fallbackAccountKey);

  if (persistIfMissing && typeof user.save === 'function') {
    await user.save();
  }

  return fallbackAccountKey;
}

async function assignUserCloudinaryAccount(user, accountKey, { persist = true } = {}) {
  const normalizedAccountKey = normalizeKey(accountKey);
  const normalizedUserId = normalizeUserId(user);

  if (!normalizedUserId || !normalizedAccountKey || !isValidCloudinaryAccountKey(normalizedAccountKey)) {
    return null;
  }

  user.cloudinaryAccountKey = normalizedAccountKey;
  cacheUserCloudinaryAccount(normalizedUserId, normalizedAccountKey);

  if (persist && typeof user.save === 'function') {
    await user.save();
  }

  return normalizedAccountKey;
}

async function clearUserCloudinaryAccount(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return;
  }

  clearUserCloudinaryAccountCache(normalizedUserId);
  await User.updateOne({ _id: normalizedUserId }, { $unset: { cloudinaryAccountKey: 1 } });
}

function getCloudinaryAccountInfo(accountKey) {
  return getCloudinaryAccountByKey(accountKey);
}

module.exports = {
  assignUserCloudinaryAccount,
  cacheUserCloudinaryAccount,
  chooseCloudinaryAccountKeyForUserId,
  clearUserCloudinaryAccount,
  clearUserCloudinaryAccountCache,
  ensureUserCloudinaryAccountKey,
  getCachedUserCloudinaryAccount,
  getCloudinaryAccountInfo,
  getUserCloudinaryAccountKey,
  normalizeUserId,
};
