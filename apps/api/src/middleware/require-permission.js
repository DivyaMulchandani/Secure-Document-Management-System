'use strict';

const permissionsService = require('../services/permissions');
const { httpError } = require('../errors');

/**
 * Route-level guard that enforces services/permissions.can() — the
 * three-layer (RBAC ceiling + case scope + resource grant) access
 * check. This is the real implementation of the golden path's
 * "authorize" step for resource-scoped actions; middleware/rbac.js
 * stays a global passthrough (see its comment) since authorization here
 * depends on route params, not something a single global step can do.
 *
 * @param {string} action a permissions.code value (import PERMISSIONS
 *   from @secure-dms/shared)
 * @param {(req: import('express').Request) => {type: string, id: string}} resolveResource
 *   builds the {type, id} pair to check from the request, e.g.
 *   `(req) => ({ type: 'CASE', id: req.params.id })`
 */
function requirePermission(action, resolveResource) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(httpError(401, 'UNAUTHENTICATED', 'Authentication required.'));
      }
      const resource = resolveResource(req);
      const allowed = await permissionsService.can(req.user, action, resource);
      if (!allowed) {
        return next(httpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requirePermission;
