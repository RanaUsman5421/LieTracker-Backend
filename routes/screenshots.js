const express = require('express');
const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Screenshot = require('../models/Screenshot');
const User = require('../models/User');
const { screenshotUpload } = require('../config/multer');
const { requireAuthenticatedUser } = require('../middleware/requireAuth');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { handleMulterError } = require('../middleware/uploadErrorHandler');
const { clearSummaryCache } = require('../services/summaryCache');
const { getDateBoundsFromQuery } = require('../utils/date');

const router = express.Router();
const screenshotUploadRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'Too many screenshot uploads. Please try again shortly.',
});

function uploadToCloudinary({ buffer, userId }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `monitask/screenshots/${userId}`,
        resource_type: 'image',
        format: 'webp',
        quality: 'auto',
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

async function deleteFromCloudinary(publicId) {
  if (!publicId) {
    return;
  }

  await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
  });
}

function validateScreenshotRequest(req, res, next) {
  const normalizedUserId = String(req.body.userId || '').trim();
  const normalizedDeviceId = String(req.body.deviceId || '').trim();

  if (!req.file) {
    console.error('[Backend] Screenshot validation failed: req.file missing');
    res.status(400).json({ success: false, message: 'Screenshot file missing' });
    return;
  }

  if (!normalizedUserId || !normalizedDeviceId) {
    console.error('[Backend] Screenshot validation failed: missing fields', {
      userId: normalizedUserId || null,
      deviceId: normalizedDeviceId || null,
    });
    res.status(400).json({ success: false, message: 'Missing required fields' });
    return;
  }

  if (String(req.authUser._id) !== normalizedUserId) {
    res.status(403).json({ success: false, message: 'Authenticated user does not match screenshot owner' });
    return;
  }

  req.screenshotMeta = {
    userId: normalizedUserId,
    deviceId: normalizedDeviceId,
    timestamp: req.body.timestamp,
  };
  next();
}

async function createScreenshot(req, res, next) {
  try {
    const { userId, deviceId, timestamp } = req.screenshotMeta;
    const requestedTimestamp = timestamp ? new Date(timestamp) : new Date();
    const screenshotTimestamp = Number.isNaN(requestedTimestamp.getTime())
      ? new Date()
      : requestedTimestamp;
    const uploaded = await uploadToCloudinary({
      buffer: req.file.buffer,
      userId,
    });

    const screenshot = await Screenshot.create({
      adminId: req.authUser.adminId,
      userId,
      deviceId,
      imageUrl: uploaded.secure_url,
      publicId: uploaded.public_id,
      timestamp: screenshotTimestamp,
    });

    await User.findByIdAndUpdate(userId, {
      lastScreenshotAt: screenshotTimestamp,
      lastSeenAt: screenshotTimestamp,
    });
    clearSummaryCache();

    res.status(201).json({
      success: true,
      data: {
        id: screenshot._id,
        userId: screenshot.userId,
        deviceId: screenshot.deviceId,
        imageUrl: screenshot.imageUrl,
        timestamp: screenshot.timestamp,
        createdAt: screenshot.createdAt,
      },
    });
  } catch (error) {
    if (req.file?.buffer) {
      console.error('[Backend] Screenshot upload pipeline error:', {
        message: error.message || String(error),
        code: error.code || null,
        name: error.name || null,
      });
    }
    next(error);
  }
}

router.post(
  '/',
  screenshotUploadRateLimit,
  requireAuthenticatedUser,
  screenshotUpload.single('screenshot'),
  validateScreenshotRequest,
  createScreenshot,
  handleMulterError
);

router.get('/:userId', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const query = { adminId: req.adminId, userId: String(userId).trim() };

    if (date) {
      const { start, end } = getDateBoundsFromQuery(date);

      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        query.timestamp = { $gte: start, $lt: end };
      }
    }

    const screenshots = await Screenshot.find(query)
      .select('userId deviceId imageUrl timestamp createdAt')
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, data: screenshots });
  } catch (error) {
    console.error('[Backend] Get screenshots error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch screenshots' });
  }
});

router.delete('/:id', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const screenshotId = String(req.params.id || '').trim();

    if (!mongoose.isValidObjectId(screenshotId)) {
      return res.status(400).json({ success: false, message: 'A valid screenshot id is required' });
    }

    const screenshot = await Screenshot.findOne({ _id: screenshotId, adminId: req.adminId });
    if (!screenshot) {
      return res.status(404).json({ success: false, message: 'Screenshot not found' });
    }

    await deleteFromCloudinary(screenshot.publicId);
    await Screenshot.findByIdAndDelete(screenshotId);

    const latestScreenshot = await Screenshot.findOne({ adminId: req.adminId, userId: screenshot.userId })
      .sort({ timestamp: -1 })
      .select('timestamp')
      .lean();

    await User.findByIdAndUpdate(screenshot.userId, {
      lastScreenshotAt: latestScreenshot?.timestamp || null,
    });
    clearSummaryCache();

    res.json({
      success: true,
      message: 'Screenshot deleted successfully',
      data: {
        id: screenshot._id,
      },
    });
  } catch (error) {
    console.error('[Backend] Delete screenshot error:', error);
    res.status(500).json({ success: false, message: 'Unable to delete screenshot' });
  }
});

router.use(handleMulterError);
router.use((error, req, res, next) => {
  console.error('[Backend] Screenshot route error:', error);
  const isCloudinaryFailure = Boolean(req.file && (error.code === 'EACCES' || error.name === 'AggregateError'));
  const isDatabaseFailure = Boolean(error?.name && (
    error.name === 'MongoServerError' ||
    error.name === 'MongooseError' ||
    error.name === 'ValidationError'
  ));

  res.status(500).json({
    success: false,
    message: isCloudinaryFailure
      ? 'Cloudinary upload failed'
      : isDatabaseFailure
        ? 'Screenshot metadata save failed'
        : error.message || 'Unable to upload screenshot',
  });
});

module.exports = router;
