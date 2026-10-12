// Manual intervals override tracking at read time. Original device samples remain
// intact, including uploads received after an administrator's correction.
function manualTimeOverlayStages(collection, timestampRange) {
  const endAnchored = { $or: [{ $ne: [{ $ifNull: ['$batchId', null] }, null] }, { $ne: [{ $ifNull: ['$clientEntryId', null] }, null] }] };
  const start = { $cond: [endAnchored, { $subtract: ['$timestamp', '$duration'] }, '$timestamp'] };
  const overlap = (a, b, c, d) => ({ $max: [0, { $subtract: [{ $min: [b, d] }, { $max: [a, c] }] }] });
  return [
    // The manual category is authoritative, even for older inconsistent records.
    { $set: {
      activeDuration: { $switch: { branches: [
        { case: { $in: ['$manualTimeType', ['inactive', 'offline']] }, then: 0 },
        { case: { $eq: ['$manualTimeType', 'active'] }, then: '$duration' },
      ], default: '$activeDuration' } },
      inactiveDuration: { $switch: { branches: [
        { case: { $eq: ['$manualTimeType', 'inactive'] }, then: '$duration' },
        { case: { $in: ['$manualTimeType', ['active', 'offline']] }, then: 0 },
      ], default: '$inactiveDuration' } },
    } },
    { $set: { __start: start } },
    { $set: { __end: { $add: ['$__start', '$duration'] }, __active: { $cond: [
      { $gt: [{ $add: [{ $ifNull: ['$activeDuration', 0] }, { $ifNull: ['$inactiveDuration', 0] }] }, 0] },
      { $ifNull: ['$activeDuration', 0] }, { $cond: [{ $eq: ['$classification', 'idle'] }, 0, '$duration'] },
    ] } } },
    ...(timestampRange ? [{ $match: { $expr: { $and: [
      ...(timestampRange.$gte instanceof Date ? [{ $gt: ['$__end', timestampRange.$gte] }] : []),
      ...(timestampRange.$lt instanceof Date ? [{ $lt: ['$__start', timestampRange.$lt] }] : []),
    ] } } }] : []),
    { $lookup: { from: collection, let: { user: '$userId', admin: '$adminId', start: '$__start', end: '$__end', id: '$_id', manual: '$sessionId' }, pipeline: [
      { $match: { sessionId: 'manual-entry', $expr: { $and: [
        { $eq: ['$userId', '$$user'] }, { $eq: ['$adminId', '$$admin'] },
        { $lt: ['$timestamp', '$$end'] }, { $gt: [{ $add: ['$timestamp', '$duration'] }, '$$start'] },
        { $or: [{ $ne: ['$$manual', 'manual-entry'] }, { $gt: ['$_id', '$$id'] }] },
      ] } } },
      { $project: { start: '$timestamp', end: { $add: ['$timestamp', '$duration'] } } },
    ], as: '__manuals' } },
    { $set: { __pieces: { $reduce: { input: '$__manuals', initialValue: [{ start: '$__start', end: '$__end' }], in: {
      $let: { vars: { cut: '$$this' }, in: { $reduce: { input: '$$value', initialValue: [], in: { $concatArrays: ['$$value', {
        $cond: [{ $or: [{ $gte: ['$$this.start', '$$cut.end'] }, { $lte: ['$$this.end', '$$cut.start'] }] }, ['$$this'],
          { $concatArrays: [
            { $cond: [{ $lt: ['$$this.start', '$$cut.start'] }, [{ start: '$$this.start', end: '$$cut.start' }], []] },
            { $cond: [{ $gt: ['$$this.end', '$$cut.end'] }, [{ start: '$$cut.end', end: '$$this.end' }], []] },
          ] },
        ],
      }] } } } },
    } } } } },
    { $unwind: '$__pieces' },
    { $replaceRoot: { newRoot: { $cond: [{ $eq: [{ $size: '$__manuals' }, 0] }, '$$ROOT', { $mergeObjects: ['$$ROOT', {
      _id: { $concat: [{ $toString: '$_id' }, ':', { $toString: '$__pieces.start' }] },
      timestamp: '$__pieces.start', duration: { $subtract: ['$__pieces.end', '$__pieces.start'] },
      activeDuration: overlap('$__pieces.start', '$__pieces.end', '$__start', { $add: ['$__start', '$__active'] }),
      inactiveDuration: overlap('$__pieces.start', '$__pieces.end', { $add: ['$__start', '$__active'] }, '$__end'),
      batchId: null, clientEntryId: null, sessionId: { $cond: [{ $eq: ['$sessionId', 'manual-entry'] }, 'manual-entry', null] },
      ...Object.fromEntries(['keystrokes', 'mouseClicks', 'mouseMovements', 'activityEvents'].map((key) => [key, {
        $multiply: [{ $ifNull: [`$${key}`, 0] }, { $divide: [{ $subtract: ['$__pieces.end', '$__pieces.start'] }, { $max: [1, '$duration'] }] }],
      }])),
    }] }] } } },
    { $unset: ['__start', '__end', '__active', '__manuals', '__pieces'] },
  ];
}

module.exports = { manualTimeOverlayStages };
