'use strict';

/**
 * `hashPassword`/`verifyPassword` (scrypt, Sprint 1),
 * `encrypt`/`decrypt`/`hashSha256` (AES-256-GCM / SHA-256, Sprint 3 —
 * document encryption + integrity), and `generateRsaKeyPair`/
 * `signRsa`/`verifyRsa` (RSA-2048/SHA-256, Sprint 5 — document
 * signatures) are all real.
 *
 * Deliberately has NO dependency on ../../config anywhere in this
 * module — scrypt params are fixed constants, and encrypt/decrypt take
 * their key material as an explicit argument rather than reading
 * config.crypto.masterKey themselves — so this module is safe to
 * `require()` from a migration (see
 * migrations/*_seed-bootstrap-admin.js), which runs outside the app's
 * normal config-fail-fast lifecycle, and so it stays trivially testable
 * with any key without needing real config.
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

// --- SHA-256 integrity (feature 6) -----------------------------------

/**
 * @param {Buffer} buffer
 * @returns {string} lowercase hex digest — the integrity ground-truth
 *   captured at upload and re-checked on every later access.
 */
function hashSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// --- AES-256-GCM document encryption (feature 5) -----------------------

const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_BYTES = 12; // 96-bit IV — the GCM-recommended size
const AES_AUTH_TAG_BYTES = 16;
const ENVELOPE_VERSION = 1; // bumps if the envelope layout ever changes

/**
 * A master "key secret" (any string/passphrase, not necessarily raw hex
 * — ENCRYPTION_MASTER_KEY is treated as KDF input, not a raw key) is
 * hashed down to a stable 32-byte AES-256 key. Deterministic: the same
 * secret always derives the same key, so decrypt() can re-derive it
 * without storing anything extra.
 */
function deriveAesKey(masterKeySecret) {
  return crypto.createHash('sha256').update(String(masterKeySecret)).digest();
}

/**
 * @param {Buffer} plaintext
 * @param {{masterKeySecret: string, keyId: string}} keyMaterial supplied
 *   by the caller (documents.service.js, from config.crypto.masterKey /
 *   config.documents.encryptionKeyId) — this module never reads config.
 * @returns {{envelope: Buffer, keyId: string}} `envelope` is a single
 *   self-describing buffer — [1 byte version][12-byte IV][16-byte auth
 *   tag][ciphertext] — that's what actually gets handed to
 *   services/storage.put(); `keyId` is recorded on the document_version
 *   row so a future key rotation knows which key to re-derive for
 *   decrypt.
 */
function encrypt(plaintext, { masterKeySecret, keyId }) {
  const key = deriveAesKey(masterKeySecret);
  const iv = crypto.randomBytes(AES_IV_BYTES);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, authTag, ciphertext]);
  return { envelope, keyId };
}

/**
 * @param {Buffer} envelope as produced by encrypt()
 * @param {{masterKeySecret: string}} keyMaterial
 * @returns {Buffer} plaintext
 * @throws if the envelope is malformed or the auth tag doesn't verify
 *   (tampered/corrupted ciphertext, or the wrong key) — GCM's built-in
 *   authenticity check, independent of and in addition to the SHA-256
 *   integrity check done at the document layer.
 */
function decrypt(envelope, { masterKeySecret }) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 1 + AES_IV_BYTES + AES_AUTH_TAG_BYTES) {
    throw new Error('crypto.decrypt: malformed envelope');
  }
  const version = envelope[0];
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`crypto.decrypt: unsupported envelope version ${version}`);
  }

  const iv = envelope.subarray(1, 1 + AES_IV_BYTES);
  const authTag = envelope.subarray(1 + AES_IV_BYTES, 1 + AES_IV_BYTES + AES_AUTH_TAG_BYTES);
  const ciphertext = envelope.subarray(1 + AES_IV_BYTES + AES_AUTH_TAG_BYTES);

  const key = deriveAesKey(masterKeySecret);
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// --- RSA-SHA256 document signatures (feature 12) -----------------------

const RSA_MODULUS_LENGTH = 2048;

/**
 * @returns {{publicKeyPem: string, privateKeyPem: string}} a fresh
 *   RSA-2048 keypair — SPKI/PEM public key (safe to store in the clear
 *   and hand out for external verification), PKCS8/PEM private key
 *   (never stored in the clear — callers must run it through encrypt()
 *   with the master key before persisting, exactly like document
 *   content).
 */
function generateRsaKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/**
 * Signs a hex SHA-256 digest (a document_version's content hash) with
 * an RSA private key. Signs the hash STRING's bytes, not the original
 * file content — the signature is always over a fixed-size, already-
 * verified digest, never the (potentially large) file itself.
 *
 * @param {string} hashHex
 * @param {string} privateKeyPem PKCS8/PEM
 * @returns {string} base64 signature
 */
function signRsa(hashHex, privateKeyPem) {
  const signature = crypto.sign('RSA-SHA256', Buffer.from(hashHex, 'utf8'), privateKeyPem);
  return signature.toString('base64');
}

/**
 * @param {string} hashHex the same digest that was signed
 * @param {string} signatureBase64
 * @param {string} publicKeyPem SPKI/PEM
 * @returns {boolean} never throws — a malformed key/signature is
 *   treated as "does not verify", the same never-throw contract as
 *   verifyPassword, so a corrupt row can never turn a verification
 *   request into a 500.
 */
function verifyRsa(hashHex, signatureBase64, publicKeyPem) {
  try {
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(hashHex, 'utf8'),
      publicKeyPem,
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[crypto] verifyRsa: could not verify signature:', err.message);
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  hashSha256,
  generateRsaKeyPair,
  signRsa,
  verifyRsa,
  hashPassword,
  verifyPassword,
};
