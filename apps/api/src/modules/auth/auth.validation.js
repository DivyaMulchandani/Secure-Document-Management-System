'use strict';

const { z } = require('zod');

/**
 * Sprint 0 — trivial schema for the stub health route. Real per-route
 * request schemas (body/params/query) land alongside real endpoints in
 * later sprints. Validation always runs after auth/rbac, before the
 * controller (wired per-route in auth.routes.js, not globally).
 */
const healthQuerySchema = z.object({}).strict();

module.exports = { healthQuerySchema };
