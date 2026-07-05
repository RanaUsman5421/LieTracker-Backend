const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { extractToken } = require('../utils/auth');
const { DASHBOARD_ADMIN_USERNAME, JWT_SECRET } = require('../config/constants');
const { ensureDefaultAdmin } = require('../services/adminBootstrap');

async function requireDashboardAuthenticatedAdmin(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ success: false, message: 'Dashboard authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const isLegacyDashboardAdminToken = decoded?.scope === 'dashboard-admin'
      && decoded?.username === DASHBOARD_ADMIN_USERNAME
      && !decoded?.adminId;

    if (isLegacyDashboardAdminToken) {
      const admin = await ensureDefaultAdmin();
      req.dashboardAuth = decoded;
      req.admin = admin;
      req.adminId = admin._id;
      next();
      return;
    }

    const isDashboardAdminToken = decoded?.scope === 'dashboard-admin' && decoded?.adminId;

    if (!isDashboardAdminToken) {
      res.status(401).json({ success: false, message: 'Invalid dashboard session' });
      return;
    }

    const admin = await Admin.findById(decoded.adminId);
    const tokenSessionId = String(decoded?.sessionId || '').trim();
    const activeSessionId = String(admin?.activeSessionId || '').trim();

    if (!admin || !tokenSessionId || !activeSessionId || tokenSessionId !== activeSessionId) {
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
