const mongoose = require('mongoose');

const screenshotSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', index: true, default: null },
  userId: { type: String, required: true, trim: true, index: true },
  deviceId: { type: String, required: true, trim: true },
  imageUrl: { type: String, required: true, trim: true },
  publicId: { type: String, required: true, trim: true },
  cloudinaryAccountKey: { type: String, trim: true, default: '' },
  timestamp: { type: Date, default: Date.now, index: true },
}, {
  timestamps: true,
});

screenshotSchema.index({ userId: 1, timestamp: -1 });
screenshotSchema.index({ adminId: 1, userId: 1, timestamp: -1 });
screenshotSchema.index({ adminId: 1, timestamp: -1 });

module.exports = mongoose.models.Screenshot || mongoose.model('Screenshot', screenshotSchema);
