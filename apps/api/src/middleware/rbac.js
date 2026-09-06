'use strict';

/**
 * STUB — Sprint 0.
 *
 * This is the slot in the middleware chain where the permission engine
 * (RBAC role + case scope + resource grant, evaluated together) belongs.
 * Real logic lands once src/services/permissions has a working
 * `can(user, action, resource)` evaluator, in a later sprint.
 *
 * For now this is a documented passthrough: it never denies a request.
 */
function rbacStub(req, res, next) {
  next();
}

module.exports = rbacStub;
