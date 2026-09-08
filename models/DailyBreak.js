const mongoose = require('mongoose');

const breakSessionSchema = new mongoose.Schema({
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  breakDurationMs: { type: Number, min: 0, default: 0 },
  overtimeDurationMs: { type: Number, min: 0, default: 0 },
}, { _id: false });

const dailyBreakSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  dateKey: { type: String, required: true, trim: true },
  allowanceMs: { type: Number, min: 0, default: 60 * 60 * 1000 },
  activeStartedAt: { type: Date, default: null },
  sessions: { type: [breakSessionSchema], default: [] },
}, { timestamps: true });

dailyBreakSchema.index({ adminId: 1, userId: 1, dateKey: 1 }, { unique: true });
dailyBreakSchema.index({ adminId: 1, userId: 1, dateKey: -1 });

module.exports = mongoose.models.DailyBreak || mongoose.model('DailyBreak', dailyBreakSchema);
