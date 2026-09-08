'use strict';

const express = require('express');
const { PERMISSIONS } = require('@secure-dms/shared');
const controller = require('./signatures.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requirePermission = require('../../middleware/require-permission');
const schemas = require('./signatures.validation');

const router = express.Router();

const documentResource = (req) => ({ type: 'DOCUMENT', id: req.params.documentId });

router.get('/health', controller.getHealth);

// A signing key belongs to the user, not to any case — self-service,
// same requireAuth-only rationale as auth.routes.js's MFA enroll/verify.
router.post('/keys', requireAuth, controller.generateKey);
router.get('/keys/me', requireAuth, controller.getMyKey);

router.get('/queue', requireAuth, controller.myQueue);

router.post(
  '/documents/:documentId/sign',
  validate({ params: schemas.documentIdParamsSchema, body: schemas.signBodySchema }),
  requirePermission(PERMISSIONS.SIGN, documentResource),
  controller.selfSign,
);
router.post(
  '/documents/:documentId/request',
  validate({ params: schemas.documentIdParamsSchema, body: schemas.requestSignatureBodySchema }),
  requirePermission(PERMISSIONS.SIGN, documentResource),
  controller.requestSignature,
);
router.get(
  '/documents/:documentId',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, documentResource),
  controller.listForDocument,
);

// Authorization for these two is "must be this pending request's
// signer_id" — a resource-instance check the generic case-role engine
// can't express — so they're requireAuth-only with the check done
// inline in the service, the same pattern as evidence.routes.js's
// transfer accept/reject.
router.post(
  '/:id/sign',
  requireAuth,
  validate({ params: schemas.signatureIdParamsSchema }),
  controller.fulfillPending,
);
router.post(
  '/:id/decline',
  requireAuth,
  validate({ params: schemas.signatureIdParamsSchema, body: schemas.declineBodySchema }),
  controller.declinePending,
);

module.exports = router;
