'use strict';

/**
 * STUB — Sprint 0.
 *
 * This is the slot in the middleware chain where JWT verification and
 * user/role loading belong (architecture: "verify JWT · load user +
 * roles"). Real logic lands once the `auth` module (src/modules/auth)
 * has a working login/token pipeline in a later sprint.
 *
 * For now this is a documented passthrough: it never rejects a request
 * and never sets req.user to anything meaningful. Do NOT rely on
 * req.user existing yet.
 */
function authStub(req, res, next) {
  req.user = null; // TODO(auth-sprint): replace with verified JWT payload
  next();
}

module.exports = authStub;
