'use strict';

const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const config = require('../../config');

/**
 * @returns {string} a new base32 TOTP secret
 */
function generateSecret() {
  return authenticator.generateSecret();
}

/**
 * @param {string} secret
 * @param {string} accountLabel usually the username
 * @returns {string} otpauth:// URI for authenticator apps
 */
function buildOtpAuthUri(secret, accountLabel) {
  return authenticator.keyuri(accountLabel, config.mfa.issuer, secret);
}

/**
 * @param {string} secret
 * @param {string} token the 6-digit code the user entered
 * @returns {boolean}
 */
function verifyToken(secret, token) {
  try {
    return authenticator.check(String(token), secret);
  } catch {
    return false;
  }
}

/**
 * @param {string} otpauthUri
 * @returns {Promise<string>} PNG data URL, for the frontend to `<img src>` directly
 */
async function generateQrCodeDataUrl(otpauthUri) {
  return QRCode.toDataURL(otpauthUri);
}

module.exports = { generateSecret, buildOtpAuthUri, verifyToken, generateQrCodeDataUrl };
