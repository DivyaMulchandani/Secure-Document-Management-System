'use strict';

const express = require('express');
const { PERMISSIONS } = require('@secure-dms/shared');
const controller = require('./sharing.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requirePermission = require('../../middleware/require-permission');
const schemas = require('./sharing.validation');

const router = express.Router();

const documentResource = (req) => ({ type: 'DOCUMENT', id: req.params.documentId });

router.get('/health', controller.getHealth);

// "Shared with me" is self-scoped by definition (shared_with = me) —
// same requireAuth-only rationale as signatures.routes.js's /queue.
router.get('/mine', requireAuth, controller.listMine);

router.post(
  '/documents/:documentId/shares',
  validate({ params: schemas.documentIdParamsSchema, body: schemas.createShareBodySchema }),
  requirePermission(PERMISSIONS.SHARE, documentResource),
  controller.createShare,
);
router.get(
  '/documents/:documentId/shares',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.SHARE, documentResource),
  controller.listForDocument,
);
router.post(
  '/documents/:documentId/shares/:shareId/revoke',
  validate({ params: schemas.shareParamsSchema }),
  requirePermission(PERMISSIONS.SHARE, documentResource),
  controller.revokeShare,
);

module.exports = router;
