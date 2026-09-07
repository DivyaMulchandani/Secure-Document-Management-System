'use strict';

/**
 * `encrypt`/`decrypt`/`hashSha256`/`signRsa`/`verifyRsa` are STILL STUBS
 * (AES-256-GCM document encryption, SHA-256 integrity, RSA-SHA256
 * signatures land in a later sprint). `hashPassword`/`verifyPassword`
 * are implemented for real here (Sprint 1 — scrypt password hashing).
 *
 * Deliberately has NO dependency on ../../config — scrypt params are
 * fixed constants, not env-configurable — so this module is safe to
 * `require()` from a migration (see
 * migrations/*_seed-bootstrap-admin.js), which runs outside the app's
 * normal config-fail-fast lifecycle.
 */

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// OWASP-recommended interactive minimums.
const SCRYPT_N = 16384; // CPU/memory cost (must be a power of 2)
const SCRYPT_R = 8; // block size
const SCRYPT_P = 1; // parallelization
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * @param {string} plaintext
 * @returns {Promise<string>} self-describing "scrypt$N$r$p$saltHex$keyHex"
 *   — storing the params alongside the hash means they can change later
 *   without invalidating already-issued hashes.
 */
async function hashPassword(plaintext) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derivedKey = await scrypt(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * @param {string} plaintext
 * @param {string} storedHash
 * @returns {Promise<boolean>} never throws — a malformed stored hash is
 *   treated as "does not match" (logged as a warning), so a corrupt row
 *   can never turn a login attempt into a 500.
 */
async function verifyPassword(plaintext, storedHash) {
  try {
    const parts = String(storedHash).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltHex, keyHex] = parts;

    const salt = Buffer.from(saltHex, 'hex');
    const expectedKey = Buffer.from(keyHex, 'hex');
    if (salt.length === 0 || expectedKey.length === 0) return false;

    // Re-derive with the STORED params, not current defaults, so a future
    // change to SCRYPT_N/R/P doesn't invalidate already-issued hashes.
    const derivedKey = await scrypt(plaintext, salt, expectedKey.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });

    if (derivedKey.length !== expectedKey.length) return false;
    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[crypto] verifyPassword: could not verify against stored hash:', err.message);
    return false;
  }
}

function notImplemented(name) {
  return () => {
    throw new Error(`crypto.${name} is not implemented yet (Sprint 0 stub)`);
  };
}

module.exports = {
  encrypt: notImplemented('encrypt'), // AES-256-GCM
  decrypt: notImplemented('decrypt'),
  hashSha256: notImplemented('hashSha256'),
  signRsa: notImplemented('signRsa'), // RSA-SHA256
  verifyRsa: notImplemented('verifyRsa'),
  hashPassword,
  verifyPassword,
};
