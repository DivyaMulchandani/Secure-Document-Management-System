'use strict';

/**
 * STUB — global step. This is the slot in the middleware chain where the
 * FULL permission engine (RBAC role + case scope + resource grant,
 * evaluated together) belongs. Real logic lands once
 * src/services/permissions has a working `can(user, action, resource)`
 * evaluator — case_members/resource_permissions don't exist until a
 * later sprint (cases/evidence).
 *
 * Sprint 1 partially satisfies the "authorize" step of the golden path
 * with simple RBAC-role checks, but those are applied per-route via
 * middleware/require-role.js (e.g. requireRole(ROLES.ADMINISTRATOR)),
 * not here — this global step stays a documented passthrough that never
 * denies a request on its own.
 */
function rbacStub(req, res, next) {
  next();
}

module.exports = rbacStub;
