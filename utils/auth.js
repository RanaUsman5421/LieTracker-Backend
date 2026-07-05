const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/constants');

function createAuthToken(user, sessionId) {
  return jwt.sign(
    {
      scope: 'tracked-user',
      userId: user._id,
      adminId: user.adminId,
      username: user.username,
      email: user.email,
      sessionId,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
}

async function getAuthenticatedUser(req) {
  const token = extractToken(req);
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return null;
    }

    const tokenSessionId = String(decoded?.sessionId || '').trim();
    const activeSessionId = String(user.activeSessionId || '').trim();
    if (!tokenSessionId || !activeSessionId || tokenSessionId !== activeSessionId) {
      return null;
    }

    return user;
  } catch (error) {
    return null;
  }
}

module.exports = {
  createAuthToken,
  extractToken,
  getAuthenticatedUser,
};
