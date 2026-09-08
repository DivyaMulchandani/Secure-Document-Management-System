'use strict';

const express = require('express');
const { ROLES } = require('@secure-dms/shared');
const controller = require('./users.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requireRole = require('../../middleware/require-role');
const schemas = require('./users.validation');

const router = express.Router();

// Route ordering matters: literal-segment paths ("/departments") MUST be
// declared before the generic "/:id" route below, or Express would treat
// the literal "departments" as a candidate :id value on GET /:id.
// "/activate/:token" is two segments so it never actually collides with
// the single-segment "/:id", but is kept grouped with the other
// public/literal routes for readability.

router.get('/health', controller.getHealth);

router.get('/lookup', requireAuth, validate({ query: schemas.lookupQuerySchema }), controller.lookup);

router.get('/departments', requireAuth, controller.listDepartments);
router.post(
  '/departments',
  requireRole(ROLES.ADMINISTRATOR),
  validate({ body: schemas.createDepartmentBodySchema }),
  controller.createDepartment,
);

router.get(
  '/activate/:token',
  validate({ params: schemas.activateParamsSchema }),
  controller.previewActivation,
);
router.post(
  '/activate/:token',
  validate({ params: schemas.activateParamsSchema, body: schemas.activateBodySchema }),
  controller.activate,
);

router.post(
  '/invite',
  requireRole(ROLES.ADMINISTRATOR),
  validate({ body: schemas.inviteBodySchema }),
  controller.invite,
);

router.get(
  '/',
  requireRole(ROLES.ADMINISTRATOR),
  validate({ query: schemas.listUsersQuerySchema }),
  controller.list,
);

router.get(
  '/:id',
  requireRole(ROLES.ADMINISTRATOR),
  validate({ params: schemas.userIdParamsSchema }),
  controller.getById,
);

router.patch(
  '/:id/status',
  requireRole(ROLES.ADMINISTRATOR),
  validate({ params: schemas.userIdParamsSchema, body: schemas.updateStatusBodySchema }),
  controller.updateStatus,
);

router.put(
  '/:id/roles',
  requireRole(ROLES.ADMINISTRATOR),
  validate({ params: schemas.userIdParamsSchema, body: schemas.updateRolesBodySchema }),
  controller.updateRoles,
);

module.exports = router;
