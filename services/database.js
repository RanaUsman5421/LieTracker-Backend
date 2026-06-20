const mongoose = require('mongoose');
const { MONGO_URI } = require('../config/constants');

function connectToDatabase() {
  return mongoose.connect(MONGO_URI)
    .then(async () => {
      console.log('[Backend] Connected to MongoDB');
      return mongoose.connection;
    })
    .catch((err) => {
      console.error('[Backend] MongoDB connection error:', err);
      throw err;
    });
}

module.exports = {
  connectToDatabase,
};
