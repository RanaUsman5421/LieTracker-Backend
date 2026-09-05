const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const Admin = require('../models/Admin');
const { createRateLimiter } = require('../middleware/rateLimit');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const {
  DASHBOARD_AUTH_TOKEN_TTL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  JWT_SECRET,
} = require('../config/constants');

const router = express.Router();
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
const dashboardAuthRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many dashboard login attempts. Please try again later.',
});

function createDashboardAuthToken(admin, sessionId) {
  return jwt.sign(
    {
      scope: 'dashboard-admin',
      adminId: admin._id,
      username: admin.username,
      email: admin.email,
      sessionId,
    },
    JWT_SECRET,
    { expiresIn: DASHBOARD_AUTH_TOKEN_TTL }
  );
}

function getTokenExpirationIso(token) {
  const decoded = jwt.decode(token);
  return decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null;
}

function serializeAdmin(admin, token, decodedToken = null) {
  return {
    id: admin._id,
    name: admin.name,
    username: admin.username,
    email: admin.email,
    expiresAt: token
      ? getTokenExpirationIso(token)
      : decodedToken?.exp
        ? new Date(decodedToken.exp * 1000).toISOString()
        : null,
  };
}

router.get('/google/config', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(503).json({ success: false, message: 'Google authentication is not configured' });
    return;
  }

  res.json({ success: true, data: { clientId: GOOGLE_CLIENT_ID } });
});

router.post('/register', dashboardAuthRateLimit, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!username || !email || !password) {
      res.status(400).json({ success: false, message: 'Username, email and password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      return;
    }

    const existingAdmin = await Admin.findOne({
      $or: [{ username }, { email }],
    });

    if (existingAdmin) {
      res.status(400).json({ success: false, message: 'Admin with this email or username already exists' });
      return;
    }

    const admin = new Admin({ name, username, email, password });
    const sessionId = crypto.randomUUID();
    admin.activeSessionId = sessionId;
    await admin.save();

    const token = createDashboardAuthToken(admin, sessionId);
    res.status(201).json({
      success: true,
      token,
      data: serializeAdmin(admin, token),
    });
  } catch (error) {
    console.error('[Backend] Dashboard register error:', error);
    res.status(500).json({ success: false, message: 'Server error during dashboard registration' });
  }
});

router.post('/login', dashboardAuthRateLimit, async (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const normalizedEmail = identifier.toLowerCase();

  if (!identifier || !password) {
    res.status(400).json({ success: false, message: 'Username/email and password are required' });
    return;
  }

  try {
    const admin = await Admin.findOne({
      $or: [
        { username: identifier },
        { email: normalizedEmail },
      ],
    });

    if (!admin) {
      res.status(401).json({ success: false, message: 'Invalid dashboard credentials' });
      return;
    }

    const isValidPassword = await admin.comparePassword(password);
    if (!isValidPassword) {
      res.status(401).json({ success: false, message: 'Invalid dashboard credentials' });
      return;
    }

    const sessionId = crypto.randomUUID();
    admin.activeSessionId = sessionId;
    await admin.save();

    const token = createDashboardAuthToken(admin, sessionId);
    res.json({
      success: true,
      token,
      data: serializeAdmin(admin, token),
    });
  } catch (error) {
    console.error('[Backend] Dashboard login error:', error);
    res.status(500).json({ success: false, message: 'Server error during dashboard login' });
  }
});

router.post('/google', dashboardAuthRateLimit, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const redirectUri = String(req.body?.redirectUri || '').trim();
  const requestOrigin = String(req.get('origin') || '').trim();
  const requestedWith = String(req.get('x-requested-with') || '');

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(503).json({ success: false, message: 'Google authentication is not configured' });
    return;
  }

  if (!code || !redirectUri) {
    res.status(400).json({ success: false, message: 'Google authorization code is required' });
    return;
  }

  if (requestedWith !== 'XmlHttpRequest' || !requestOrigin || redirectUri !== requestOrigin) {
    res.status(403).json({ success: false, message: 'Invalid Google authentication request' });
    return;
  }

  try {
    const { tokens } = await googleOAuthClient.getToken({
      code,
      redirect_uri: redirectUri,
    });

    if (!tokens.id_token) {
      res.status(401).json({ success: false, message: 'Google did not return a valid identity token' });
      return;
    }

    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const googleProfile = ticket.getPayload();
    const email = String(googleProfile?.email || '').trim().toLowerCase();

    if (!email || googleProfile?.email_verified !== true) {
      res.status(401).json({ success: false, message: 'A verified Google email is required' });
      return;
    }

    const admin = await Admin.findOne({ email });
    if (!admin) {
      res.status(403).json({ success: false, message: 'No dashboard admin account is registered with this Google email' });
      return;
    }

    const sessionId = crypto.randomUUID();
    admin.activeSessionId = sessionId;
    await admin.save();

    const token = createDashboardAuthToken(admin, sessionId);
    res.json({
      success: true,
      token,
      data: serializeAdmin(admin, token),
    });
  } catch (error) {
    console.error('[Backend] Google dashboard login error:', error?.message || error);
    res.status(401).json({ success: false, message: 'Google authentication failed. Please try again.' });
  }
});

router.get('/verify', requireDashboardAuthenticatedAdmin, (req, res) => {
  res.json({
    success: true,
    data: serializeAdmin(req.admin, null, req.dashboardAuth),
  });
});

router.post('/logout', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    await Admin.findByIdAndUpdate(req.adminId, { activeSessionId: null });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Backend] Dashboard logout error:', error);
    res.status(500).json({ success: false, message: 'Server error during dashboard logout' });
  }
});

module.exports = router;
