const mongoose = require('mongoose');
const TrackingEntry = require('../models/TrackingEntry');
const TrackingBucket = require('../models/TrackingBucket');

const MINUTE_MS = 60 * 1000;

function bucketFor(entry) {
  const minuteStart = new Date(Math.floor(entry.timestamp.getTime() / MINUTE_MS) * MINUTE_MS);
  return {
    _id: `${entry.userId}:${entry.deviceId}:${minuteStart.toISOString()}`,
    adminId: entry.adminId,
    userId: entry.userId,
    userEmail: entry.userEmail,
    deviceId: entry.deviceId,
    minuteStart,
  };
}

function bucketSample(entry) {
  const { adminId, userId, userEmail, deviceId, ...sample } = entry;
  return { _id: new mongoose.Types.ObjectId(), ...sample, createdAt: new Date() };
}

async function insertTrackingEntries(entries) {
  const bucketed = entries.filter((entry) => entry.clientEntryId && entry.userId);
  const legacy = entries.filter((entry) => !entry.clientEntryId || !entry.userId);
  let inserted = 0;

  if (legacy.length) {
    const result = await TrackingEntry.bulkWrite(
      legacy.map((entry) => entry.clientEntryId
        ? {
          updateOne: {
            filter: {
              userId: entry.userId,
              deviceId: entry.deviceId,
              clientEntryId: entry.clientEntryId,
            },
            update: { $setOnInsert: entry },
            upsert: true,
          },
        }
        : { insertOne: { document: entry } }),
      { ordered: false }
    );
    inserted += (result.insertedCount || 0) + (result.upsertedCount || 0);
  }

  if (bucketed.length) {
    // A response lost during an old-backend upload can leave a committed raw
    // entry in the client outbox. Do not copy that retry into a new bucket.
    const existingRaw = await TrackingEntry.find({
      $or: bucketed.map((entry) => ({
        userId: entry.userId,
        deviceId: entry.deviceId,
        clientEntryId: entry.clientEntryId,
      })),
    }).select('userId deviceId clientEntryId').lean();
    const rawIds = new Set(existingRaw.map((entry) => (
      `${entry.userId}:${entry.deviceId}:${entry.clientEntryId}`
    )));
    const newSamples = bucketed.filter((entry) => !rawIds.has(
      `${entry.userId}:${entry.deviceId}:${entry.clientEntryId}`
    ));
    if (!newSamples.length) return inserted;

    const buckets = new Map();
    for (const entry of newSamples) {
      const bucket = bucketFor(entry);
      buckets.set(bucket._id, bucket);
    }
    await TrackingBucket.bulkWrite(
      [...buckets.values()].map(({ _id, ...metadata }) => ({
        updateOne: {
          filter: { _id },
          update: { $setOnInsert: { ...metadata, samples: [] } },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    // A conditional push is atomic and makes partial uploads safe to retry.
    // The bucket is created first so an upsert filter cannot race on _id.
    const result = await TrackingBucket.bulkWrite(
      newSamples.map((entry) => ({
        updateOne: {
          filter: {
            _id: bucketFor(entry)._id,
            'samples.clientEntryId': { $ne: entry.clientEntryId },
          },
          update: { $push: { samples: bucketSample(entry) } },
        },
      })),
      { ordered: false }
    );
    inserted += result.modifiedCount || 0;
  }

  return inserted;
}

function bucketReadStages(firstMatch) {
  const match = {};
  if (firstMatch && Object.prototype.hasOwnProperty.call(firstMatch, 'adminId')) {
    match.adminId = firstMatch.adminId;
  }
  if (firstMatch && Object.prototype.hasOwnProperty.call(firstMatch, 'userId')) {
    match.userId = firstMatch.userId;
  }
  if (firstMatch && Object.prototype.hasOwnProperty.call(firstMatch, 'userEmail')) {
    match.userEmail = firstMatch.userEmail;
  }
  if (Array.isArray(firstMatch?.$or)
      && firstMatch.$or.every((clause) => Object.keys(clause).every(
        (key) => key === 'userId' || key === 'userEmail'
      ))) {
    match.$or = firstMatch.$or;
  }
  const timestamp = firstMatch?.timestamp;
  if (timestamp && typeof timestamp === 'object' && !Array.isArray(timestamp)) {
    const minuteStart = {};
    if (timestamp.$gte instanceof Date) {
      minuteStart.$gte = new Date(Math.floor(timestamp.$gte.getTime() / MINUTE_MS) * MINUTE_MS);
    }
    if (timestamp.$lt instanceof Date) {
      minuteStart.$lt = new Date(Math.ceil(timestamp.$lt.getTime() / MINUTE_MS) * MINUTE_MS);
    }
    if (Object.keys(minuteStart).length) match.minuteStart = minuteStart;
  }
  // The exact sample filter runs after expansion, preserving date boundaries.
  return [
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $unwind: '$samples' },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            {
              adminId: '$adminId',
              userId: '$userId',
              userEmail: '$userEmail',
              deviceId: '$deviceId',
            },
            '$samples',
          ],
        },
      },
    },
  ];
}

// Present old standalone entries and new bucketed samples as one unchanged
// logical TrackingEntry stream to every dashboard/report query.
function aggregateTrackingEntries(pipeline) {
  const firstMatch = pipeline[0]?.$match;
  const unionStage = {
    $unionWith: {
      coll: TrackingBucket.collection.name,
      pipeline: [
        ...bucketReadStages(firstMatch),
        ...(firstMatch ? [{ $match: firstMatch }] : []),
      ],
    },
  };
  return TrackingEntry.aggregate([
    ...(firstMatch ? [pipeline[0], unionStage, ...pipeline.slice(1)] : [unionStage, ...pipeline]),
  ]);
}

module.exports = {
  aggregateTrackingEntries,
  bucketFor,
  bucketReadStages,
  insertTrackingEntries,
};
