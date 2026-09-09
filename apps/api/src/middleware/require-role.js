'use strict';

const { httpError } = require('../errors');

/**
 * Route-level RBAC-role guard (the ONLY layer of authorization Sprint 1
 * implements — case-scoped/resource-scoped permission checking is
 * `services/permissions.can()`, still a stub, future work). Does its own
 * authentication check, so it's usable standalone — no need to also
 * stack requireAuth in front of it.
 *
 * @param {...string} allowedRoles e.g. ROLES.STATE_HQ_ADMIN from @secure-dms/shared
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(httpError(401, 'UNAUTHENTICATED', 'Authentication required.'));
    }
    const hasAllowedRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasAllowedRole) {
      return next(httpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }
    return next();
  };
}

module.exports = requireRole;
