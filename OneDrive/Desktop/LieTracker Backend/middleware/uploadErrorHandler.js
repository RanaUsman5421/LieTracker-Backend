const { multer } = require('../config/multer');

function handleMulterError(error, req, res, next) {
  if (!(error instanceof multer.MulterError)) {
    next(error);
    return;
  }

  console.error('[Backend] Multer error:', {
    code: error.code,
    field: error.field || null,
    message: error.message,
  });

  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      success: false,
      message: 'Uploaded file is too large. Maximum allowed size is 5MB.',
    });
    return;
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({
      success: false,
      message: `Unexpected upload field${error.field ? ` "${error.field}"` : ''}.`,
    });
    return;
  }

  res.status(400).json({
    success: false,
    message: error.message || 'Invalid upload request',
  });
}

module.exports = {
  handleMulterError,
};
