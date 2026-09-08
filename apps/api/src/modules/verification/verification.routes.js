'use strict';

const express = require('express');
const { PERMISSIONS } = require('@secure-dms/shared');
const controller = require('./verification.controller');
const validate = require('../../middleware/validate');
const requirePermission = require('../../middleware/require-permission');
const schemas = require('./verification.validation');

const router = express.Router();

const documentResource = (req) => ({ type: 'DOCUMENT', id: req.params.documentId });

router.get('/health', controller.getHealth);

router.get(
  '/documents/:documentId',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VERIFY, documentResource),
  controller.verifyDocument,
);
router.get(
  '/documents/:documentId/history',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, documentResource),
  controller.listRecords,
);

// Deliberately public — no requireAuth at all. This IS the
// "external-verifier path": anyone holding a verification code (printed
// on the document, or shared as a link/QR) can confirm authenticity
// without an account. The app-wide rate limiter (middleware/rate-
// limit.js) is what keeps this from being brute-forceable.
router.get('/public/:code', validate({ params: schemas.codeParamsSchema }), controller.verifyPublic);

module.exports = router;
