'use strict';

const express = require('express');
const { PERMISSIONS } = require('@secure-dms/shared');
const controller = require('./approval.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requirePermission = require('../../middleware/require-permission');
const schemas = require('./approval.validation');

const router = express.Router();

const documentResource = (req) => ({ type: 'DOCUMENT', id: req.params.documentId });

router.get('/health', controller.getHealth);

// "My turn" inbox is self-scoped by definition — same requireAuth-only
// rationale as signatures.routes.js's /queue.
router.get('/inbox', requireAuth, controller.myInbox);

router.post(
  '/documents/:documentId/requests',
  validate({ params: schemas.documentIdParamsSchema, body: schemas.submitBodySchema }),
  requirePermission(PERMISSIONS.EDIT, documentResource),
  controller.submitForApproval,
);
router.get(
  '/documents/:documentId/requests',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, documentResource),
  controller.listForDocument,
);
router.post(
  '/documents/:documentId/finalize',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, documentResource),
  controller.finalizeDocument,
);

// Authorization is "must be this step's approver_id, and it must be
// their turn" — a resource-instance check the generic case-role engine
// can't express, done inline in the service (loadActionableStepOrThrow)
// — same pattern as evidence's transfer accept/reject and signatures'
// pending-queue fulfil/decline.
router.post(
  '/steps/:stepId/decide',
  requireAuth,
  validate({ params: schemas.stepIdParamsSchema, body: schemas.decideBodySchema }),
  controller.decideStep,
);

module.exports = router;
