const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnvironment() {
  const primaryEnvPath = path.join(__dirname, '..', '.env');
  const fallbackEnvPath = path.join(__dirname, '..', '.env.example');

  if (fs.existsSync(primaryEnvPath)) {
    dotenv.config({ path: primaryEnvPath });
    console.log('[Backend] Environment loaded from .env');
    return;
  }

  if (fs.existsSync(fallbackEnvPath)) {
    dotenv.config({ path: fallbackEnvPath });
    console.warn('[Backend] Environment loaded from .env.example because .env was not found');
    return;
  }

  dotenv.config();
  console.warn('[Backend] No .env file found in backend directory');
}

module.exports = {
  loadEnvironment,
};
