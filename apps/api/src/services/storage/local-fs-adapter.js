'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('../../config');

const rootPath = path.resolve(config.storage.rootPath);

class PathTraversalError extends Error {
  constructor(storageKey) {
    super(`Refusing storage key that escapes the storage root: ${storageKey}`);
    this.name = 'PathTraversalError';
    this.status = 400;
    this.code = 'PATH_TRAVERSAL';
  }
}

class NotFoundError extends Error {
  constructor(storageKey) {
    super(`No object at storage key: ${storageKey}`);
    this.name = 'NotFoundError';
    this.status = 404;
    this.code = 'STORAGE_OBJECT_NOT_FOUND';
  }
}

/**
 * Resolves a storage key to an absolute filesystem path, rejecting
 * anything that would escape `rootPath` (parent-dir segments, absolute
 * paths, null bytes, symlink-style tricks resolved via path.resolve).
 * Callers should generate storage keys themselves (e.g. `<uuid>/<uuid>.bin`)
 * rather than deriving them from user-supplied filenames.
 *
 * @param {string} storageKey
 * @returns {string} absolute path, guaranteed inside rootPath
 */
function resolveSafePath(storageKey) {
  if (typeof storageKey !== 'string' || storageKey.length === 0 || storageKey.includes('\0')) {
    throw new PathTraversalError(storageKey);
  }

  const resolved = path.resolve(rootPath, storageKey);
  const boundary = rootPath.endsWith(path.sep) ? rootPath : rootPath + path.sep;

  if (resolved !== rootPath && !resolved.startsWith(boundary)) {
    throw new PathTraversalError(storageKey);
  }

  return resolved;
}

/**
 * @param {string} storageKey
 * @param {Buffer} data
 * @returns {Promise<void>}
 *
 * This adapter is encryption-agnostic by design (matches the
 * architecture's storage-adapter contract: "put/get encrypted objects
 * by storage_key; never returns plaintext"). As of Sprint 3, callers
 * (documents.service.js) always pass an AES-256-GCM envelope from
 * services/crypto.encrypt() here — `data` is opaque ciphertext bytes as
 * far as this module is concerned, and it is never responsible for
 * encrypting/decrypting them itself.
 */
async function put(storageKey, data) {
  const target = resolveSafePath(storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

/**
 * @param {string} storageKey
 * @returns {Promise<Buffer>} the raw stored bytes — ciphertext, if the
 *   caller encrypted before put(); decryption is the caller's job (see
 *   services/crypto.decrypt()), not this adapter's.
 */
async function get(storageKey) {
  const target = resolveSafePath(storageKey);
  try {
    return await fs.readFile(target);
  } catch (err) {
    if (err.code === 'ENOENT') throw new NotFoundError(storageKey);
    throw err;
  }
}

/**
 * @param {string} storageKey
 * @returns {Promise<boolean>}
 */
async function exists(storageKey) {
  const target = resolveSafePath(storageKey);
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} storageKey
 * @returns {Promise<void>}
 */
async function remove(storageKey) {
  const target = resolveSafePath(storageKey);
  try {
    await fs.unlink(target);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { put, get, exists, remove, resolveSafePath, PathTraversalError, NotFoundError };
