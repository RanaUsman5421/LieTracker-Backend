const express = require('express');
const User = require('../models/User');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { getCloudinaryAccountSummaries } = require('../services/cloudinaryAccounts');

const router = express.Router();

router.use(requireDashboardAuthenticatedAdmin);

router.get('/', async (req, res) => {
  try {
    const [users, accounts] = await Promise.all([
      User.find({ adminId: req.adminId }).select('_id cloudinaryAccountKey').lean(),
      Promise.resolve(getCloudinaryAccountSummaries()),
    ]);

    const userCountByAccount = new Map();
    for (const user of users) {
      const key = String(user.cloudinaryAccountKey || '').trim();
      if (!key) {
        continue;
      }

      userCountByAccount.set(key, (userCountByAccount.get(key) || 0) + 1);
    }

    res.json({
      success: true,
      data: accounts.map((account) => ({
        ...account,
        userCount: userCountByAccount.get(account.key) || 0,
      })),
    });
  } catch (error) {
    console.error('[Backend] Get cloudinary accounts error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch Cloudinary accounts' });
  }
});

module.exports = router;
