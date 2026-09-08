const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  dateKey: { type: String, required: true, trim: true },
  timezone: { type: String, required: true, trim: true, default: 'Asia/Karachi' },
  checkInAt: { type: Date, required: true },
  scheduledDutyStartTime: { type: String, trim: true, default: '' },
  scheduledDutyEndTime: { type: String, trim: true, default: '' },
  scheduleSnapshotAt: { type: Date, default: null },
  checkInSource: {
    type: String,
    enum: ['tracking_start', 'manual_button'],
    default: 'tracking_start',
  },
  checkOutAt: { type: Date, default: null },
  checkOutMethod: {
    type: String,
    enum: ['manual', 'automatic_midnight', null],
    default: null,
  },
  checkOutNote: { type: String, trim: true, default: '' },
  checkOutHistory: [{
    checkOutAt: { type: Date, required: true },
    checkOutMethod: { type: String, enum: ['manual', 'automatic_midnight'], required: true },
    checkOutNote: { type: String, trim: true, default: '' },
  }],
  recheckApproval: {
    status: {
      type: String,
      enum: ['none', 'approved', 'rejected', 'consumed'],
      default: 'none',
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    usedAt: { type: Date, default: null },
  },
  recheckHistory: [{
    decision: { type: String, enum: ['approved', 'rejected'], required: true },
    reviewedAt: { type: Date, required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  }],
  recheckCount: { type: Number, min: 0, default: 0 },
  workedDurationMs: { type: Number, min: 0, default: 0 },
  state: {
    type: String,
    enum: ['checked_in', 'checked_out'],
    default: 'checked_in',
    index: true,
  },
}, { timestamps: true });

attendanceSchema.index({ adminId: 1, userId: 1, dateKey: 1 }, { unique: true });
attendanceSchema.index({ state: 1, dateKey: 1 });
attendanceSchema.index({ adminId: 1, dateKey: 1 });

module.exports = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
