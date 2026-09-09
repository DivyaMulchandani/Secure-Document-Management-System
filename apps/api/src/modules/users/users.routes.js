'use strict';

const express = require('express');
const { createsRolesFor } = require('@secure-dms/shared');
const controller = require('./users.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const { httpError } = require('../../errors');
const schemas = require('./users.validation');

const router = express.Router();

// Route ordering matters: literal-segment paths ("/departments") MUST be
// declared before the generic "/:id" route below, or Express would treat
// the literal "departments" as a candidate :id value on GET /:id.
// "/activate/:token" is two segments so it never actually collides with
// the single-segment "/:id", but is kept grouped with the other
// public/literal routes for readability.
//
// Every route below that used to be a flat `requireRole(ROLES.ADMINISTRATOR)`
// gate is now `requireAuth` + `requireAnyAdmin` (or no extra gate at all,
// for /invite and /departments where the real authority check is
// data-dependent — "can THIS role create THAT role, within THIS unit" —
// and lives in users.service.js, same resource-instance-authorization
// shape as every other module's transfer/decide/fulfil endpoints).

/** True if this user's role can create at least one other role — i.e. is any `_ADMIN`, not an `_OFFICER`. */
function requireAnyAdmin(req, res, next) {
  const roleName = (req.user?.roles || [])[0];
  if (createsRolesFor(roleName).length === 0) {
    return next(httpError(403, 'FORBIDDEN', 'Your role does not manage any accounts.'));
  }
  return next();
}

router.get('/health', controller.getHealth);

router.get('/lookup', requireAuth, validate({ query: schemas.lookupQuerySchema }), controller.lookup);

router.get('/departments', requireAuth, controller.listDepartments);
router.post(
  '/departments',
  requireAuth,
  requireAnyAdmin,
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

// Authority for WHO may invite WHOM is fully data-dependent (role
// hierarchy + department subtree), checked inside
// users.service.js#assertCreationAuthority — requireAuth only here.
router.post('/invite', requireAuth, validate({ body: schemas.inviteBodySchema }), controller.invite);

router.get('/', requireAuth, requireAnyAdmin, validate({ query: schemas.listUsersQuerySchema }), controller.list);

router.get(
  '/:id',
  requireAuth,
  requireAnyAdmin,
  validate({ params: schemas.userIdParamsSchema }),
  controller.getById,
);

router.patch(
  '/:id/status',
  requireAuth,
  requireAnyAdmin,
  validate({ params: schemas.userIdParamsSchema, body: schemas.updateStatusBodySchema }),
  controller.updateStatus,
);

router.put(
  '/:id/roles',
  requireAuth,
  requireAnyAdmin,
  validate({ params: schemas.userIdParamsSchema, body: schemas.updateRolesBodySchema }),
  controller.updateRoles,
);

module.exports = router;
