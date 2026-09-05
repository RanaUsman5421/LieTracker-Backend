const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
  username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: {
    type: String,
    minlength: 6,
    required() { return !this.googleId; },
  },
  googleId: { type: String, unique: true, sparse: true, trim: true },
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  activeSessionId: { type: String, trim: true, default: null },
}, {
  timestamps: true,
});

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

adminSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
