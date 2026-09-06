'use strict';

/**
 * STUB — Sprint 0.
 *
 * Real implementations (AES-256-GCM encrypt/decrypt, SHA-256 hashing,
 * RSA-SHA256 sign/verify, scrypt password hashing) land in the crypto
 * sprint. Callers should import this module now so the call sites exist
 * and the storage/documents/auth modules never have to change their
 * import shape later.
 */

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
  hashPassword: notImplemented('hashPassword'), // scrypt
  verifyPassword: notImplemented('verifyPassword'),
};
