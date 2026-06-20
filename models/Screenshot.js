const mongoose = require('mongoose');

const screenshotSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  deviceId: { type: String, required: true, trim: true },
  imageUrl: { type: String, required: true, trim: true },
  publicId: { type: String, required: true, trim: true },
  timestamp: { type: Date, default: Date.now, index: true },
}, {
  timestamps: true,
});

screenshotSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.models.Screenshot || mongoose.model('Screenshot', screenshotSchema);
