'use strict';

/**
 * The first shared error type in the codebase — needed from Sprint 1
 * onward because auth/users introduce many distinct, cross-layer
 * failure modes (INVALID_CREDENTIALS, ACCOUNT_LOCKED, INVALID_OTP,
 * INVITATION_INVALID, VALIDATION_ERROR, CONFLICT, NOT_FOUND,
 * UNAUTHENTICATED, FORBIDDEN, ...) that all need one reusable shape:
 * exactly the `err.status`/`err.code` fields middleware/error-handler.js
 * already reads.
 */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} [message]
 * @returns {HttpError}
 */
function httpError(status, code, message) {
  return new HttpError(status, code, message);
}

module.exports = { HttpError, httpError };
