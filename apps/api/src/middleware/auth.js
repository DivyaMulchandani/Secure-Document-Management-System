'use strict';

const jwtService = require('../services/jwt');

/**
 * Global, step 8 in the chain — verifies a Bearer JWT if present and
 * attaches `req.user`, but ALWAYS calls next(): it never rejects a
 * request on its own, since public routes (/auth/login,
 * /users/activate/:token, /health, ...) must stay reachable with no
 * token at all. Route-level guards (require-auth.js, require-role.js)
 * are what actually reject unauthenticated/unauthorized requests.
 *
 * Note: role claims are snapshotted into the JWT at issuance time — an
 * admin changing a user's roles takes effect for that user only after
 * their next /auth/refresh (bounded by the short access-token TTL).
 * Accepted tradeoff, not a bug.
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? jwtService.verifyAccessToken(token) : null;

  req.user = payload ? { id: payload.sub, username: payload.username, roles: payload.roles } : null;
  next();
}

module.exports = authMiddleware;
