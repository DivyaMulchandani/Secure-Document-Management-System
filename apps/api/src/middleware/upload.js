'use strict';

const multer = require('multer');
const config = require('../config');
const { httpError } = require('../errors');

/**
 * Memory storage — the raw bytes land in `req.file.buffer` and are
 * never written to disk unencrypted ("plaintext never rests": the
 * documents service hashes + AES-256-GCM-encrypts the buffer before it
 * ever reaches services/storage.put()).
 *
 * `fileFilter` rejects disallowed MIME types before the file is even
 * fully buffered; the size limit is enforced by multer itself and
 * surfaces as a LIMIT_FILE_SIZE MulterError, translated to a clean 413
 * below rather than the framework's default 500.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.documents.maxSizeBytes },
  fileFilter(req, file, cb) {
    if (!config.documents.allowedMimeTypes.includes(file.mimetype)) {
      cb(httpError(400, 'UNSUPPORTED_FILE_TYPE', `File type not allowed: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Wraps a single-file multer middleware so a MulterError becomes a
 * clean, consistent HttpError instead of an uncaught exception /
 * generic 500 — `single(fieldName)` still expects the file under that
 * multipart field name.
 * @param {string} fieldName
 */
function uploadSingleFile(fieldName) {
  const middleware = upload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          httpError(
            413,
            'FILE_TOO_LARGE',
            `File exceeds the maximum allowed size of ${Math.floor(config.documents.maxSizeBytes / (1024 * 1024))}MB.`,
          ),
        );
      }
      return next(err);
    });
  };
}

module.exports = { uploadSingleFile };
