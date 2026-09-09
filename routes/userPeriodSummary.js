const express = require('express');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { requireAuthenticatedUser } = require('../middleware/requireAuth');
const { getUserPeriodSummaryWithOptions } = require('../modules/user-period-summary/userPeriodSummary.service');

const router = express.Router();

router.get('/me', requireAuthenticatedUser, async (req, res) => {
  try {
    const data = await getUserPeriodSummaryWithOptions(String(req.authUser._id), {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      adminId: req.authUser.adminId,
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Backend] Tracked user period summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch your tracking period summary',
    });
  }
});

router.get('/:identifier', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const data = await getUserPeriodSummaryWithOptions(req.params.identifier, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      adminId: req.adminId,
    });

    if (!data.user) {
      return res.status(404).json({
        success: false,
        message: 'User not found for tracking period summary',
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[Backend] User period summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch user tracking period summary',
    });
  }
});

module.exports = router;
