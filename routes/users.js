const express = require('express');
const { profilePictureUpload } = require('../config/multer');
const User = require('../models/User');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { handleMulterError } = require('../middleware/uploadErrorHandler');
const {
  getDefaultCloudinaryAccountKey,
  getLegacyCloudinaryAccountKey,
  isValidCloudinaryAccountKey,
  normalizeKey,
} = require('../services/cloudinaryAccounts');
const {
  destroyCloudinaryAsset,
  uploadBufferToCloudinary,
} = require('../services/cloudinaryStorage');
const {
  cacheUserCloudinaryAccount,
  clearUserCloudinaryAccountCache,
} = require('../services/cloudinaryAssignment');
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

function normalizeCloudinaryAccountSelection(value) {
  const normalizedValue = normalizeKey(value);

  if (!normalizedValue) {
    return '';
  }

  if (isValidCloudinaryAccountKey(normalizedValue)) {
    return normalizedValue;
  }

  return null;
}

async function uploadProfilePicture({ file, user }) {
  const explicitAccountKey = normalizeCloudinaryAccountSelection(user.cloudinaryAccountKey);
  const fallbackAccountKey =
    explicitAccountKey ||
    getLegacyCloudinaryAccountKey() ||
    getDefaultCloudinaryAccountKey();
  if (!fallbackAccountKey) {
    throw new Error('No Cloudinary account is configured for profile picture uploads');
  }

  const uploaded = await uploadBufferToCloudinary({
    buffer: file.buffer,
    filename: file.originalname || `profile_${String(user._id || Date.now())}.png`,
    accountKey: fallbackAccountKey,
    folder: `monitask/profile-pictures/${user._id}`,
    resourceType: 'image',
  });

  return {
    imageUrl: uploaded.secure_url,
    publicId: uploaded.public_id,
    cloudinaryAccountKey: fallbackAccountKey,
  };
}

async function destroyProfilePicture(publicId, accountKey) {
  if (!publicId) {
    return;
  }

  try {
    const resolvedAccountKey =
      normalizeCloudinaryAccountSelection(accountKey) ||
      getLegacyCloudinaryAccountKey() ||
      getDefaultCloudinaryAccountKey();

    if (!resolvedAccountKey) {
      return;
    }

    await destroyCloudinaryAsset({
      publicId,
      accountKey: resolvedAccountKey,
      resourceType: 'image',
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
    dutyHours: user.dutyHours ?? 8,
    cloudinaryAccountKey: user.cloudinaryAccountKey || '',
    profilePicture: user.profilePicture?.imageUrl
      ? {
          imageUrl: user.profilePicture.imageUrl,
          publicId: user.profilePicture.publicId,
          cloudinaryAccountKey: user.profilePicture.cloudinaryAccountKey || '',
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
      'username email department designation dutyHours cloudinaryAccountKey profilePicture createdAt lastSeenAt lastScreenshotAt'
    );
    res.json({ success: true, data: sortUsersByPresence(users.map(serializeUser)) });
  } catch (error) {
    console.error('[Backend] Get users error:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch users' });
  }
});

router.post('/', userWriteRateLimit, requireDashboardAuthenticatedAdmin, maybeParseProfilePicture, async (req, res) => {
  try {
    const { username, email, password, department, designation, dutyHours, cloudinaryAccountKey } = req.body;

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
    const normalizedCloudinaryAccountKey = normalizeCloudinaryAccountSelection(cloudinaryAccountKey);
    if (cloudinaryAccountKey && normalizedCloudinaryAccountKey === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cloudinary account selection' });
    }
    const parsedDutyHours = Number(dutyHours);
    const normalizedDutyHours = Number.isFinite(parsedDutyHours) && parsedDutyHours >= 0
      ? parsedDutyHours
      : 8;

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
      dutyHours: normalizedDutyHours,
    });

    let nextProfilePicture = null;

    if (normalizedCloudinaryAccountKey) {
      user.cloudinaryAccountKey = normalizedCloudinaryAccountKey;
      cacheUserCloudinaryAccount(user, normalizedCloudinaryAccountKey);
    }

    if (req.file) {
      nextProfilePicture = await uploadProfilePicture({
        file: req.file,
        user,
      });
      user.profilePicture = nextProfilePicture;
    }

    try {
      await user.save();
    } catch (error) {
      await destroyProfilePicture(nextProfilePicture?.publicId, nextProfilePicture?.cloudinaryAccountKey);
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
    const { username, email, password, department, designation, dutyHours, cloudinaryAccountKey } = req.body;
    const userId = String(req.params.id || '').trim();

    if (!userId) {
      return res.status(400).json({ success: false, message: 'A valid user id is required' });
    }

    const hasUsername = typeof username !== 'undefined';
    const hasEmail = typeof email !== 'undefined';
    const hasDepartment = typeof department !== 'undefined';
    const hasDesignation = typeof designation !== 'undefined';
    const hasDutyHours = typeof dutyHours !== 'undefined';
    const hasCloudinaryAccountKey = typeof cloudinaryAccountKey !== 'undefined';
    const normalizedUsername = hasUsername ? String(username || '').trim() : '';
    const normalizedEmail = hasEmail ? String(email || '').trim().toLowerCase() : '';
    const normalizedPassword = String(password || '');
    const normalizedDepartment = hasDepartment ? String(department || '').trim() : '';
    const normalizedDesignation = hasDesignation ? String(designation || '').trim() : '';
    const normalizedCloudinaryAccountKey = normalizeCloudinaryAccountSelection(cloudinaryAccountKey);
    if (hasCloudinaryAccountKey && cloudinaryAccountKey && normalizedCloudinaryAccountKey === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cloudinary account selection' });
    }

    if (normalizedPassword && normalizedPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ _id: userId, adminId: req.adminId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const duplicateChecks = [];
    const parsedDutyHoursValue = hasDutyHours && dutyHours !== null && dutyHours !== '' ? Number(dutyHours) : null;
    const normalizedDutyHours = hasDutyHours && parsedDutyHoursValue !== null && Number.isFinite(parsedDutyHoursValue) && parsedDutyHoursValue >= 0
      ? parsedDutyHoursValue
      : user.dutyHours ?? 8;

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

    const previousCloudinaryAccountKey = normalizeKey(user.cloudinaryAccountKey);
    if (hasDutyHours) {
      user.dutyHours = normalizedDutyHours;
    }

    if (hasCloudinaryAccountKey) {
      user.cloudinaryAccountKey = normalizedCloudinaryAccountKey;
      if (normalizedCloudinaryAccountKey) {
        cacheUserCloudinaryAccount(user, normalizedCloudinaryAccountKey);
      } else {
        clearUserCloudinaryAccountCache(user);
      }
    }

    if (normalizedPassword) {
      user.password = normalizedPassword;
    }

    const previousProfilePicturePublicId = user.profilePicture?.publicId || '';
    const previousProfilePictureAccountKey =
      user.profilePicture?.cloudinaryAccountKey ||
      previousCloudinaryAccountKey ||
      getUserCloudinaryAccountKey(user) ||
      getDefaultCloudinaryAccountKey();
    let nextProfilePicture = null;

    if (req.file) {
      nextProfilePicture = await uploadProfilePicture({
        file: req.file,
        user,
      });
      user.profilePicture = nextProfilePicture;
    }

    try {
      await user.save();
    } catch (error) {
      await destroyProfilePicture(nextProfilePicture?.publicId, nextProfilePicture?.cloudinaryAccountKey);
      throw error;
    }

    if (nextProfilePicture?.publicId && previousProfilePicturePublicId) {
      await destroyProfilePicture(previousProfilePicturePublicId, previousProfilePictureAccountKey);
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

    const deletedUser = await User.findOne({ _id: userId, adminId: req.adminId });
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await destroyProfilePicture(
      deletedUser.profilePicture?.publicId || '',
      deletedUser.profilePicture?.cloudinaryAccountKey || deletedUser.cloudinaryAccountKey || getDefaultCloudinaryAccountKey()
    );
    await User.findByIdAndDelete(userId);
    clearUserCloudinaryAccountCache(deletedUser);

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
