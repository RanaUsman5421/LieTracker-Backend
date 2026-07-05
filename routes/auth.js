const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ensureDefaultAdmin } = require('../services/adminBootstrap');
const { createRateLimiter } = require('../middleware/rateLimit');
const { requireAuthenticatedUser } = require('../middleware/requireAuth');
const { createAuthToken } = require('../utils/auth');
const { JWT_SECRET } = require('../config/constants');

const router = express.Router();
const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 30,
  message: 'Too many authentication attempts. Please try again later.',
});

router.post('/signup', authRateLimit, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username, email and password' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const defaultAdmin = await ensureDefaultAdmin();
    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await User.findOne({
      adminId: defaultAdmin._id,
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email or username already exists' });
    }

    const user = new User({
      adminId: defaultAdmin._id,
      username: normalizedUsername,
      email: normalizedEmail,
      password,
    });
    await user.save();

    const sessionId = crypto.randomUUID();
    user.activeSessionId = sessionId;
    await user.save();

    const token = createAuthToken(user, sessionId);
    res.status(201).json({ success: true, message: 'User created successfully', token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    console.error('[Backend] Signup error:', error);
    res.status(500).json({ success: false, message: 'Server error during signup' });
  }
});

router.post('/login', authRateLimit, async (req, res) => {
  try {
    const { username, email, identifier, password } = req.body;
    const loginIdentifier = String(identifier || username || email || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!loginIdentifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username or email and password' });
    }

    const userLookup = [{ username: loginIdentifier }];
    const emailLookup = normalizedEmail || loginIdentifier.toLowerCase();

    if (emailLookup) {
      userLookup.push({ email: emailLookup });
    }

    const users = await User.find({ $or: userLookup }).limit(10);
    let user = null;

    for (const candidate of users) {
      if (await candidate.comparePassword(password)) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const sessionId = crypto.randomUUID();
    user.activeSessionId = sessionId;
    await user.save();

    const token = createAuthToken(user, sessionId);
    res.json({ success: true, token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    console.error('[Backend] Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication token missing' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('_id adminId username email activeSessionId').lean();
    const tokenSessionId = String(decoded?.sessionId || '').trim();
    const activeSessionId = String(user?.activeSessionId || '').trim();

    if (!user || !tokenSessionId || !activeSessionId || tokenSessionId !== activeSessionId) {
      return res.status(401).json({ success: false, message: 'Session expired because this account signed in on another device' });
    }

    res.json({ success: true, data: decoded });
  } catch (error) {
    console.error('[Backend] Auth verify error:', error);
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
});

router.post('/logout', requireAuthenticatedUser, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.authUser._id, { activeSessionId: null });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Backend] Logout error:', error);
    res.status(500).json({ success: false, message: 'Server error during logout' });
  }
});

module.exports = router;
