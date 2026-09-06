'use strict';

/**
 * The ONLY module in this codebase allowed to read `process.env` directly.
 * Every other module imports `config` from here. Validates required vars
 * and fails fast (before app.listen()) if anything is missing.
 */

require('dotenv').config();

const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_MASTER_KEY',
  'STORAGE_ROOT_PATH',
];

function readRequired() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name] || process.env[name].trim() === '');
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[config] Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in real values before starting the API.',
    );
    process.exit(1);
  }
}

// Skip the fail-fast exit under test — individual tests set what they need
// and shouldn't be able to kill the whole Jest process.
if (process.env.NODE_ENV !== 'test') {
  readRequired();
}

const config = Object.freeze({
  server: Object.freeze({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    bodyLimit: process.env.BODY_LIMIT || '5mb',
  }),
  db: Object.freeze({
    url: process.env.DATABASE_URL || '',
  }),
  jwt: Object.freeze({
    accessSecret: process.env.JWT_ACCESS_SECRET || '',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  }),
  crypto: Object.freeze({
    masterKey: process.env.ENCRYPTION_MASTER_KEY || '',
  }),
  storage: Object.freeze({
    rootPath: process.env.STORAGE_ROOT_PATH || './apps/api/storage-data',
  }),
  rateLimit: Object.freeze({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX || 100),
  }),
  log: Object.freeze({
    level: process.env.LOG_LEVEL || 'info',
  }),
});

module.exports = config;
