'use strict';

const { httpError } = require('../errors');

/**
 * Route-level guard: 401s if middleware/auth.js didn't attach a user
 * (missing/invalid/expired token). Apply per-route, after the global
 * auth/rbac steps, same as validation.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return next(httpError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  }
  return next();
}

module.exports = requireAuth;
