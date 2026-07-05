const express = require('express');
const cloudinary = require('../config/cloudinary');
const { profilePictureUpload } = require('../config/multer');
const User = require('../models/User');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { handleMulterError } = require('../middleware/uploadErrorHandler');
const { getUserPresence } = require('../utils/presence');

const router = express.Router();
const userWriteRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 50,
  message: 'Too many user creation requests. Please try again later.',
});

function maybeParseProfilePicture(req, res, next) {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }

  profilePictureUpload.single('profilePicture')(req, res, next);
}

function uploadProfilePicture({ buffer, userId }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `monitask/profile-pictures/${userId}`,
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

async function replaceProfilePicture({ file, userId }) {
  const uploaded = await uploadProfilePicture({ buffer: file.buffer, userId });

  return {
    imageUrl: uploaded.secure_url,
    publicId: uploaded.public_id,
  };
}

async function destroyProfilePicture(publicId) {
  if (!publicId) {
    return;
  }

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });
  } catch (error) {
    console.warn('[Backend] Failed to delete profile picture:', error.message || error);
  }
}

function serializeUser(user) {
  const presence = getUserPresence(user);

  return {
    _id: user._id,
    id: user._id,
    username: user.username,
    email: user.email,
    department: user.department,
    designation: user.designation,
    profilePicture: user.profilePicture?.imageUrl
      ? {
          imageUrl: user.profilePicture.imageUrl,
          publicId: user.profilePicture.publicId,
        }
      : null,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
    lastScreenshotAt: user.lastScreenshotAt,
    presence,
  };
}

function getTimeValue(value) {
  const date = value ? new Date(value) : null;
  const time = date ? date.getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function getUserPresenceSortTime(user) {
  return Math.max(
    getTimeValue(user.presence?.lastSeenAt),
    getTimeValue(user.lastSeenAt),
    getTimeValue(user.lastScreenshotAt)
  );
}

function sortUsersByPresence(users) {
  return users.sort((firstUser, secondUser) => {
    const firstIsOnline = firstUser.presence?.isOnline ? 1 : 0;
    const secondIsOnline = secondUser.presence?.isOnline ? 1 : 0;

    if (firstIsOnline !== secondIsOnline) {
      return secondIsOnline - firstIsOnline;
    }

    const lastSeenDifference = getUserPresenceSortTime(secondUser) - getUserPresenceSortTime(firstUser);
    if (lastSeenDifference !== 0) {
      return lastSeenDifference;
    }

    return getTimeValue(secondUser.createdAt) - getTimeValue(firstUser.createdAt);
  });
}

router.get('/', requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const users = await User.find(
      { adminId: req.adminId },
      'username email department designation profilePicture createdAt lastSeenAt lastScreenshotAt'
    );
    res.json({ success: true, data: sortUsersByPresence(users.map(serializeUser)) });
  } catch (error) {
    console.error('[Backend] Get users error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch users' });
  }
});

router.post('/', userWriteRateLimit, requireDashboardAuthenticatedAdmin, maybeParseProfilePicture, async (req, res) => {
  try {
    const { username, email, password, department, designation } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username, email and password' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedDepartment = String(department || '').trim();
    const normalizedDesignation = String(designation || '').trim();

    const existingUser = await User.findOne({
      adminId: req.adminId,
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email or username already exists' });
    }

    const user = new User({
      adminId: req.adminId,
      username: normalizedUsername,
      email: normalizedEmail,
      password: String(password),
      department: normalizedDepartment,
      designation: normalizedDesignation,
    });

    let nextProfilePicture = null;

    if (req.file) {
      nextProfilePicture = await replaceProfilePicture({
        file: req.file,
        userId: String(user._id),
      });
      user.profilePicture = nextProfilePicture;
    }

    try {
      await user.save();
    } catch (error) {
      await destroyProfilePicture(nextProfilePicture?.publicId);
      throw error;
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: serializeUser(user),
    });
  } catch (error) {
    console.error('[Backend] Create user error:', error);
    res.status(500).json({ success: false, message: 'Server error during user creation' });
  }
});

router.put('/:id', userWriteRateLimit, requireDashboardAuthenticatedAdmin, maybeParseProfilePicture, async (req, res) => {
  try {
    const { username, email, password, department, designation } = req.body;
    const userId = String(req.params.id || '').trim();

    if (!userId) {
      return res.status(400).json({ success: false, message: 'A valid user id is required' });
    }

    const hasUsername = typeof username !== 'undefined';
    const hasEmail = typeof email !== 'undefined';
    const hasDepartment = typeof department !== 'undefined';
    const hasDesignation = typeof designation !== 'undefined';
    const normalizedUsername = hasUsername ? String(username || '').trim() : '';
    const normalizedEmail = hasEmail ? String(email || '').trim().toLowerCase() : '';
    const normalizedPassword = String(password || '');
    const normalizedDepartment = hasDepartment ? String(department || '').trim() : '';
    const normalizedDesignation = hasDesignation ? String(designation || '').trim() : '';

    if (normalizedPassword && normalizedPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ _id: userId, adminId: req.adminId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const duplicateChecks = [];

    if (hasEmail && normalizedEmail && normalizedEmail !== user.email) {
      duplicateChecks.push({ email: normalizedEmail });
    }

    if (hasUsername && normalizedUsername && normalizedUsername !== user.username) {
      duplicateChecks.push({ username: normalizedUsername });
    }

    if ((hasUsername && !normalizedUsername) || (hasEmail && !normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Username and email cannot be empty' });
    }

    const existingUser = duplicateChecks.length
      ? await User.findOne({
          adminId: req.adminId,
          _id: { $ne: userId },
          $or: duplicateChecks,
        })
      : null;

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email or username already exists' });
    }

    if (hasUsername) {
      user.username = normalizedUsername;
    }

    if (hasEmail) {
      user.email = normalizedEmail;
    }

    if (hasDepartment) {
      user.department = normalizedDepartment;
    }

    if (hasDesignation) {
      user.designation = normalizedDesignation;
    }

    if (normalizedPassword) {
      user.password = normalizedPassword;
    }

    const previousProfilePicturePublicId = user.profilePicture?.publicId || '';
    let nextProfilePicture = null;

    if (req.file) {
      nextProfilePicture = await replaceProfilePicture({
        file: req.file,
        userId: String(user._id),
      });
      user.profilePicture = nextProfilePicture;
    }

    try {
      await user.save();
    } catch (error) {
      await destroyProfilePicture(nextProfilePicture?.publicId);
      throw error;
    }

    if (nextProfilePicture?.publicId && previousProfilePicturePublicId) {
      await destroyProfilePicture(previousProfilePicturePublicId);
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: serializeUser(user),
    });
  } catch (error) {
    console.error('[Backend] Update user error:', error);
    res.status(500).json({ success: false, message: 'Server error during user update' });
  }
});

router.delete('/:id', userWriteRateLimit, requireDashboardAuthenticatedAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();

    if (!userId) {
      return res.status(400).json({ success: false, message: 'A valid user id is required' });
    }

    const deletedUser = await User.findOneAndDelete({ _id: userId, adminId: req.adminId });
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
      data: {
        id: deletedUser._id,
        username: deletedUser.username,
        email: deletedUser.email,
      },
    });
  } catch (error) {
    console.error('[Backend] Delete user error:', error);
    res.status(500).json({ success: false, message: 'Server error during user deletion' });
  }
});

router.use(handleMulterError);

module.exports = router;
