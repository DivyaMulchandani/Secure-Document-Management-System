'use strict';

const express = require('express');
const controller = require('./permissions.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const schemas = require('./permissions.validation');

const router = express.Router();

router.get('/health', controller.getHealth);

// Fine-grained authority (who may grant/list/revoke on THIS resource)
// is data-dependent (depends on the resource's type/id, not just the
// route), so it's enforced inside permissions.service.js rather than a
// route-level guard here — see assertGrantAuthority there.
router.post('/grants', requireAuth, validate({ body: schemas.grantBodySchema }), controller.grant);
router.get(
  '/grants',
  requireAuth,
  validate({ query: schemas.listGrantsQuerySchema }),
  controller.listGrants,
);
router.delete(
  '/grants/:id',
  requireAuth,
  validate({ params: schemas.grantIdParamsSchema }),
  controller.revokeGrant,
);

module.exports = router;
