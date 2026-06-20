const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createRateLimiter } = require('../middleware/rateLimit');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const {
  DASHBOARD_ADMIN_PASSWORD,
  DASHBOARD_ADMIN_USERNAME,
  DASHBOARD_AUTH_TOKEN_TTL,
  JWT_SECRET,
} = require('../config/constants');

const router = express.Router();
const dashboardAuthRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many dashboard login attempts. Please try again later.',
});

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createDashboardAuthToken() {
  return jwt.sign(
    {
      scope: 'dashboard-admin',
      username: DASHBOARD_ADMIN_USERNAME,
    },
    JWT_SECRET,
    { expiresIn: DASHBOARD_AUTH_TOKEN_TTL }
  );
}

function getTokenExpirationIso(token) {
  const decoded = jwt.decode(token);
  return decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null;
}

router.post('/login', dashboardAuthRateLimit, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    res.status(400).json({ success: false, message: 'Username and password are required' });
    return;
  }

  const usernameMatches = safeCompare(username, DASHBOARD_ADMIN_USERNAME);
  const passwordMatches = safeCompare(password, DASHBOARD_ADMIN_PASSWORD);

  if (!usernameMatches || !passwordMatches) {
    res.status(401).json({ success: false, message: 'Invalid dashboard credentials' });
    return;
  }

  const token = createDashboardAuthToken();
  res.json({
    success: true,
    token,
    data: {
      username: DASHBOARD_ADMIN_USERNAME,
      expiresAt: getTokenExpirationIso(token),
    },
  });
});

router.get('/verify', requireDashboardAuthenticatedAdmin, (req, res) => {
  res.json({
    success: true,
    data: {
      username: req.dashboardAuth.username,
      expiresAt: req.dashboardAuth.exp ? new Date(req.dashboardAuth.exp * 1000).toISOString() : null,
    },
  });
});

module.exports = router;
