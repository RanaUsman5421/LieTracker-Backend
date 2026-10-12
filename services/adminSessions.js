const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AdminSession = require('../models/AdminSession');
const { DASHBOARD_AUTH_TOKEN_TTL, JWT_SECRET } = require('../config/constants');

async function createAdminSession(admin) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign({
    scope: 'dashboard-admin', adminId: admin._id,
    username: admin.username, email: admin.email,
    sessionId, sessionVersion: 2,
  }, JWT_SECRET, { expiresIn: DASHBOARD_AUTH_TOKEN_TTL });
  const expiresAt = new Date(jwt.decode(token).exp * 1000);
  await AdminSession.create({ adminId: admin._id, sessionId, expiresAt });
  return token;
}

module.exports = { createAdminSession };
