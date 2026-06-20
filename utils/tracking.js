const mongoose = require('mongoose');
const { normalizeIdentifier, normalizeObjectId } = require('./common');

function buildResolvedActiveDurationExpression() {
  return {
    $let: {
      vars: {
        duration: { $ifNull: ['$duration', 0] },
        activeDuration: { $ifNull: ['$activeDuration', 0] },
        inactiveDuration: { $ifNull: ['$inactiveDuration', 0] },
      },
      in: {
        $cond: [
          { $gt: [{ $add: ['$$activeDuration', '$$inactiveDuration'] }, 0] },
          '$$activeDuration',
          {
            $cond: [
              { $eq: ['$classification', 'idle'] },
              0,
              '$$duration',
            ],
          },
        ],
      },
    },
  };
}

function buildResolvedInactiveDurationExpression() {
  return {
    $let: {
      vars: {
        duration: { $ifNull: ['$duration', 0] },
        activeDuration: { $ifNull: ['$activeDuration', 0] },
        inactiveDuration: { $ifNull: ['$inactiveDuration', 0] },
      },
      in: {
        $cond: [
          { $gt: [{ $add: ['$$activeDuration', '$$inactiveDuration'] }, 0] },
          '$$inactiveDuration',
          {
            $cond: [
              { $eq: ['$classification', 'idle'] },
              '$$duration',
              0,
            ],
          },
        ],
      },
    },
  };
}

function buildUserAggregationKey() {
  return {
    userId: { $ifNull: ['$userId', null] },
    userEmail: { $ifNull: ['$userEmail', 'unknown'] },
  };
}

function buildUserScopedQuery(identifier) {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const rawIdentifier = normalizeObjectId(identifier);
  const userScopedQuery = [];

  if (normalizedIdentifier) {
    userScopedQuery.push({ userEmail: normalizedIdentifier });
  }

  if (rawIdentifier && mongoose.Types.ObjectId.isValid(rawIdentifier)) {
    userScopedQuery.push({ userId: new mongoose.Types.ObjectId(rawIdentifier) });
  }

  return userScopedQuery.length > 1 ? { $or: userScopedQuery } : (userScopedQuery[0] || {});
}

function buildUserLookupQuery({ userId, userEmail }) {
  const normalizedUserEmail = normalizeIdentifier(userEmail);
  const normalizedUserId = normalizeObjectId(userId);
  const userLookupQuery = [];

  if (normalizedUserEmail) {
    userLookupQuery.push({ email: normalizedUserEmail });
  }

  if (normalizedUserId && mongoose.Types.ObjectId.isValid(normalizedUserId)) {
    userLookupQuery.push({ _id: new mongoose.Types.ObjectId(normalizedUserId) });
  }

  return userLookupQuery.length > 1 ? { $or: userLookupQuery } : (userLookupQuery[0] || {});
}

module.exports = {
  buildResolvedActiveDurationExpression,
  buildResolvedInactiveDurationExpression,
  buildUserAggregationKey,
  buildUserScopedQuery,
  buildUserLookupQuery,
};
