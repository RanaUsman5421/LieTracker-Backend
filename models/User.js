const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', index: true, default: null },
  username: { type: String, required: true, trim: true, minlength: 3 },
  email: { type: String, required: true, trim: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  activeSessionId: { type: String, trim: true, default: null },
  department: { type: String, trim: true, default: '' },
  designation: { type: String, trim: true, default: '' },
  dutyHours: { type: Number, default: 8, min: 0 },
  profilePicture: {
    imageUrl: { type: String, trim: true, default: '' },
    publicId: { type: String, trim: true, default: '' },
  },
  lastSeenAt: { type: Date, default: null },
  lastScreenshotAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

userSchema.index({ adminId: 1, email: 1 }, { unique: true });
userSchema.index({ adminId: 1, username: 1 }, { unique: true });
userSchema.index({ adminId: 1, createdAt: -1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
