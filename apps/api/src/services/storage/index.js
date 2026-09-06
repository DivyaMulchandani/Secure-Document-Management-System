'use strict';

/**
 * @typedef {Object} StorageAdapter
 * @property {(storageKey: string, data: Buffer) => Promise<void>} put
 * @property {(storageKey: string) => Promise<Buffer>} get
 * @property {(storageKey: string) => Promise<boolean>} exists
 * @property {(storageKey: string) => Promise<void>} remove
 */

/**
 * The active storage adapter. Swapping to S3 (or any other backend)
 * later means writing an s3-adapter.js implementing the same four
 * methods and changing only the require() below — no caller changes.
 * @type {StorageAdapter}
 */
module.exports = require('./local-fs-adapter');
