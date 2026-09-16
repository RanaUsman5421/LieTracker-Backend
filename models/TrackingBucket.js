const mongoose = require('mongoose');

// One indexed document per user/device/UTC minute. The original tracking
// samples remain intact inside it so existing reports can read the same data.
const trackingBucketSchema = new mongoose.Schema({
  _id: String,
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userEmail: { type: String, required: true },
  deviceId: { type: String, required: true },
  minuteStart: { type: Date, required: true },
  samples: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

trackingBucketSchema.index({ adminId: 1, minuteStart: -1 });
trackingBucketSchema.index({ adminId: 1, userId: 1, minuteStart: -1 });
trackingBucketSchema.index({ adminId: 1, userEmail: 1, minuteStart: -1 });

module.exports = mongoose.models.TrackingBucket
  || mongoose.model('TrackingBucket', trackingBucketSchema);
