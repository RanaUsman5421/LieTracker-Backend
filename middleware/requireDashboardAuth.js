const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const AdminSession = require('../models/AdminSession');
const { extractToken } = require('../utils/auth');
const { JWT_SECRET } = require('../config/constants');

async function requireDashboardAuthenticatedAdmin(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ success: false, message: 'Dashboard authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { maxAge: '6h' });

    const isDashboardAdminToken = decoded?.scope === 'dashboard-admin' && decoded?.adminId;

    if (!isDashboardAdminToken) {
      res.status(401).json({ success: false, message: 'Invalid dashboard session' });
      return;
    }

    const admin = await Admin.findById(decoded.adminId);
    const tokenSessionId = String(decoded?.sessionId || '').trim();
    const activeSessionId = String(admin?.activeSessionId || '').trim();

    if (!admin || !tokenSessionId || !Number.isFinite(decoded.exp)) {
      res.status(401).json({ success: false, message: 'Invalid dashboard session' });
      return;
    }

    const session = await AdminSession.exists({
      adminId: admin._id, sessionId: tokenSessionId, expiresAt: { $gt: new Date() },
    });
    // Existing sessions remain usable until their original expiry. New logins
    // never overwrite this legacy field, and v2 tokens cannot use the fallback.
    const validLegacySession = decoded.sessionVersion === undefined
      && activeSessionId && tokenSessionId === activeSessionId;
    if (!session && !validLegacySession) {
      res.status(401).json({ success: false, message: 'Invalid dashboard session' });
      return;
    }

    req.dashboardAuth = decoded;
    req.admin = admin;
    req.adminId = admin._id;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired dashboard session' });
  }
}

module.exports = {
  requireDashboardAuthenticatedAdmin,
};
