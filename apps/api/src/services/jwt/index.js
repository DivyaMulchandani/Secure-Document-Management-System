'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');

const DURATION_RE = /^(\d+)(ms|s|m|h|d)$/;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * @param {string} ttlString e.g. "15m", "7d" — the same shape every TTL
 *   env var in this repo already uses.
 * @returns {number} milliseconds
 */
function parseDuration(ttlString) {
  const match = DURATION_RE.exec(String(ttlString).trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${ttlString}" (expected e.g. "15m", "7d")`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}

/**
 * @param {{id: string, username: string, roles: string[]}} user
 * @returns {string} signed JWT
 */
function signAccessToken({ id, username, roles }) {
  return jwt.sign({ sub: id, username, roles }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  });
}

/**
 * @param {string} token
 * @returns {{sub: string, username: string, roles: string[]} | null}
 *   NEVER throws — required contract for middleware/auth.js, which must
 *   never reject a request just because a token is missing/invalid.
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret);
  } catch {
    return null;
  }
}

/**
 * High-entropy opaque token generator, shared by refresh tokens AND
 * invitation tokens — only the hash is ever persisted.
 * @returns {{raw: string, hash: string}}
 */
function generateOpaqueToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashOpaqueToken(raw) };
}

/**
 * @param {string} raw
 * @returns {string} sha256 hex digest — NOT services/crypto.hashSha256,
 *   which is still an explicit Sprint-0 stub for the document-integrity
 *   feature; this is a separate, unrelated use of the same primitive.
 */
function hashOpaqueToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  parseDuration,
  signAccessToken,
  verifyAccessToken,
  generateOpaqueToken,
  hashOpaqueToken,
};
