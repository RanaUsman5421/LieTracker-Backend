const isProduction = process.env.NODE_ENV === 'production';

function readRequiredEnv(name, fallback = '') {
  const value = String(process.env[name] || fallback).trim();

  if (!value && isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const JWT_SECRET = readRequiredEnv('JWT_SECRET', isProduction ? '' : 'dev-only-jwt-secret');
const MONGO_URI = readRequiredEnv('MONGO_URI', isProduction ? '' : 'mongodb://127.0.0.1:27017/monitask');
const DASHBOARD_ADMIN_USERNAME = readRequiredEnv('DASHBOARD_ADMIN_USERNAME', isProduction ? '' : 'MonitaskAdmin');
const DASHBOARD_ADMIN_PASSWORD = readRequiredEnv('DASHBOARD_ADMIN_PASSWORD', isProduction ? '' : 'AdminMonitask');
const DASHBOARD_AUTH_TOKEN_TTL = String(process.env.DASHBOARD_AUTH_TOKEN_TTL || '6h').trim() || '6h';
const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';
const SUMMARY_CACHE_TTL_MS = 15000;
const CORS_ALLOWED_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || '').trim();

module.exports = {
  JWT_SECRET,
  MONGO_URI,
  DASHBOARD_ADMIN_USERNAME,
  DASHBOARD_ADMIN_PASSWORD,
  DASHBOARD_AUTH_TOKEN_TTL,
  PORT,
  HOST,
  SUMMARY_CACHE_TTL_MS,
  CORS_ALLOWED_ORIGINS,
};
