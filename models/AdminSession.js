const mongoose = require('mongoose');

const adminSessionSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  sessionId: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// Cleanup is asynchronous; authentication also checks expiresAt explicitly.
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AdminSession || mongoose.model('AdminSession', adminSessionSchema);
