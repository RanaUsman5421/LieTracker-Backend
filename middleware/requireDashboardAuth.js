const jwt = require('jsonwebtoken');
const { extractToken } = require('../utils/auth');
const { DASHBOARD_ADMIN_USERNAME, JWT_SECRET } = require('../config/constants');

function requireDashboardAuthenticatedAdmin(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ success: false, message: 'Dashboard authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const isDashboardAdminToken = decoded?.scope === 'dashboard-admin'
      && decoded?.username === DASHBOARD_ADMIN_USERNAME;

    if (!isDashboardAdminToken) {
      res.status(401).json({ success: false, message: 'Invalid dashboard session' });
      return;
    }

    req.dashboardAuth = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired dashboard session' });
  }
}

module.exports = {
  requireDashboardAuthenticatedAdmin,
};
