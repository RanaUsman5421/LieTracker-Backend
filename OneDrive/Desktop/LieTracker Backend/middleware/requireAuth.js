const { getAuthenticatedUser } = require('../utils/auth');

async function requireAuthenticatedUser(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuthenticatedUser,
};
