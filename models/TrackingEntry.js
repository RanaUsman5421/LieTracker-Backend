const mongoose = require('mongoose');

const trackingSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', index: true, default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deviceId: { type: String, trim: true, default: 'unknown-device' },
  app: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  url: { type: String, trim: true, default: null },
  duration: { type: Number, required: true, min: 0 },
  activeDuration: { type: Number, default: 0, min: 0 },
  inactiveDuration: { type: Number, default: 0, min: 0 },
  keystrokes: { type: Number, default: 0, min: 0 },
  mouseClicks: { type: Number, default: 0, min: 0 },
  mouseMovements: { type: Number, default: 0, min: 0 },
  activityEvents: { type: Number, default: 0, min: 0 },
  activityFrequency: { type: Number, default: 0, min: 0 },
  productivityScore: { type: Number, default: 0, min: 0 },
  classification: { type: String, trim: true, enum: ['active', 'idle'], default: 'active' },
  sessionId: { type: String, trim: true, default: null },
  userEmail: { type: String, trim: true, lowercase: true, default: 'unknown' },
  timestamp: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

trackingSchema.index({ userId: 1, timestamp: -1 });
trackingSchema.index({ userEmail: 1, timestamp: -1 });
trackingSchema.index({ timestamp: -1 });
trackingSchema.index({ adminId: 1, userId: 1, timestamp: -1 });
trackingSchema.index({ adminId: 1, userEmail: 1, timestamp: -1 });
trackingSchema.index({ adminId: 1, timestamp: -1 });

module.exports = mongoose.models.TrackingEntry || mongoose.model('TrackingEntry', trackingSchema);
