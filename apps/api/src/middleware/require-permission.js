'use strict';

const permissionsService = require('../services/permissions');
const securityEvents = require('../services/security-events');
const { pool } = require('../db/pool');
const { httpError } = require('../errors');

/**
 * Route-level guard that enforces services/permissions.can() — the
 * three-layer (RBAC ceiling + case scope + resource grant) access
 * check. This is the real implementation of the golden path's
 * "authorize" step for resource-scoped actions; middleware/rbac.js
 * stays a global passthrough (see its comment) since authorization here
 * depends on route params, not something a single global step can do.
 *
 * "Deny is logged too" (docs/architecture — Request lifecycle): a
 * rejected check writes a real security_events(UNAUTH_ACCESS) row, not
 * through withTransaction/a caller-supplied client (there's no domain
 * write to pair it with — the request is being rejected specifically
 * because it may NOT act), just a direct insert via the pool. This is
 * the resource-aware guard, so it's the one that gets this treatment
 * first; middleware/require-role.js's simpler role-only 403s don't have
 * a resource to attach the event to and are left unlogged for now.
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
        await securityEvents.raise(pool, {
          eventType: 'UNAUTH_ACCESS',
          severity: 'MEDIUM',
          userId: req.user.id,
          resourceType: resource.type,
          resourceId: resource.id,
          description: `Denied ${action} on ${resource.type} ${resource.id}`,
        });
        return next(httpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requirePermission;
