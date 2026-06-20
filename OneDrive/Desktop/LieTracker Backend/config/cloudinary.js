const cloudinary = require('cloudinary').v2;

function getCloudinaryConfigStatus() {
  const values = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  };

  return {
    values,
    missing: Object.entries(values)
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key),
  };
}

const cloudinaryConfigStatus = getCloudinaryConfigStatus();

cloudinary.config(cloudinaryConfigStatus.values);

module.exports = cloudinary;
module.exports.getCloudinaryConfigStatus = getCloudinaryConfigStatus;
