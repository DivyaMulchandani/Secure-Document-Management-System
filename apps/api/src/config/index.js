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
  'BOOTSTRAP_ADMIN_USERNAME',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_PASSWORD',
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
  auth: Object.freeze({
    lockoutThreshold: Number(process.env.AUTH_LOCKOUT_THRESHOLD || 5),
    invitationTtl: process.env.INVITATION_TTL || '7d',
  }),
  mfa: Object.freeze({
    issuer: process.env.MFA_ISSUER || 'Secure DMS',
  }),
  mail: Object.freeze({
    // Empty host is the signal services/mail uses to run in disabled/log-only mode.
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Secure DMS <no-reply@secure-dms.local>',
  }),
  // Read by the bootstrap-admin seed migration too (directly from
  // process.env there, not via this module — see migrations/*seed-bootstrap-admin.js).
  bootstrapAdmin: Object.freeze({
    username: process.env.BOOTSTRAP_ADMIN_USERNAME || '',
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || '',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  }),
  app: Object.freeze({
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  }),
  documents: Object.freeze({
    maxSizeBytes: Number(process.env.DOCUMENT_MAX_SIZE_MB || 25) * 1024 * 1024,
    allowedMimeTypes: Object.freeze(
      (
        process.env.DOCUMENT_ALLOWED_MIME_TYPES ||
        'application/pdf,image/jpeg,image/png,image/tiff,application/msword,' +
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    // Fixed identifier for the current single master key (see
    // services/crypto) — the seam document_versions.key_id gives us for
    // introducing real key rotation / envelope encryption later without
    // a schema change.
    encryptionKeyId: process.env.ENCRYPTION_KEY_ID || 'master-v1',
  }),
});

module.exports = config;
