'use strict';

const express = require('express');
const { PERMISSIONS, CASE_CREATOR_ROLES } = require('@secure-dms/shared');
const controller = require('./cases.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requireRole = require('../../middleware/require-role');
const requirePermission = require('../../middleware/require-permission');
const schemas = require('./cases.validation');

const router = express.Router();

const caseResource = (req) => ({ type: 'CASE', id: req.params.id });

// NOTE on ordering below: `validate({params: ...})` runs BEFORE
// `requirePermission` on every :id route, deliberately reversing the
// usual "auth/rbac then validate" convention — requirePermission's
// resolveResource feeds req.params.id straight into a `uuid`-typed SQL
// column; validating it's a real UUID first turns a malformed id into a
// clean 400 instead of a Postgres cast error surfacing as a 500.

router.get('/health', controller.getHealth);

// "Create / own cases": every role that runs an actual investigating/
// operational unit (CASE_CREATOR_ROLES = everyone except the oversight
// tier and the external tier — see packages/shared/src/constants/roles.js).
router.post(
  '/',
  requireRole(...CASE_CREATOR_ROLES),
  validate({ body: schemas.createCaseBodySchema }),
  controller.create,
);

// Any authenticated role may list — the service scopes results to the
// caller's own case memberships unless they're in the audit/oversight tier.
router.get('/', requireAuth, validate({ query: schemas.listCasesQuerySchema }), controller.list);

router.get(
  '/:id',
  validate({ params: schemas.caseIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, caseResource),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: schemas.caseIdParamsSchema, body: schemas.updateCaseBodySchema }),
  requirePermission(PERMISSIONS.EDIT, caseResource),
  controller.update,
);

// Legal-transition + reopen-authorization checks happen in the service;
// this guard only confirms the actor may EDIT the case at all.
router.patch(
  '/:id/status',
  validate({ params: schemas.caseIdParamsSchema, body: schemas.updateCaseStatusBodySchema }),
  requirePermission(PERMISSIONS.EDIT, caseResource),
  controller.updateStatus,
);

router.post(
  '/:id/members',
  validate({ params: schemas.caseIdParamsSchema, body: schemas.addMemberBodySchema }),
  requirePermission(PERMISSIONS.SHARE, caseResource),
  controller.addMember,
);

router.get(
  '/:id/members',
  validate({ params: schemas.caseIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, caseResource),
  controller.listMembers,
);

router.delete(
  '/:id/members/:userId',
  validate({ params: schemas.memberParamsSchema }),
  requirePermission(PERMISSIONS.SHARE, caseResource),
  controller.removeMember,
);

module.exports = router;
