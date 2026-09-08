'use strict';

const express = require('express');
const { PERMISSIONS } = require('@secure-dms/shared');
const controller = require('./evidence.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requirePermission = require('../../middleware/require-permission');
const { uploadSingleFile } = require('../../middleware/upload');
const schemas = require('./evidence.validation');

const router = express.Router();

const evidenceResource = (req) => ({ type: 'EVIDENCE', id: req.params.id });
const caseResourceFromBody = (req) => ({ type: 'CASE', id: req.body.caseId });
const caseResourceFromQuery = (req) => ({ type: 'CASE', id: req.query.caseId });

router.get('/health', controller.getHealth);

// multer first — populates req.body (non-file fields) that both
// validate() and requirePermission() (reads req.body.caseId) depend on.
router.post(
  '/',
  uploadSingleFile('file'),
  validate({ body: schemas.registerEvidenceBodySchema }),
  requirePermission(PERMISSIONS.UPLOAD, caseResourceFromBody),
  controller.register,
);

router.get(
  '/',
  validate({ query: schemas.listEvidenceQuerySchema }),
  requirePermission(PERMISSIONS.VIEW, caseResourceFromQuery),
  controller.list,
);

router.get(
  '/:id',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, evidenceResource),
  controller.getById,
);

// Resource (an existing evidence item) is identifiable from
// req.params.id alone, so authorization runs BEFORE multer buffers the
// upload — same ordering rationale as documents.routes.js's
// POST /:id/versions.
router.post(
  '/:id/artifacts',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, evidenceResource),
  uploadSingleFile('file'),
  controller.addArtifact,
);

router.get(
  '/:id/artifacts',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, evidenceResource),
  controller.listArtifacts,
);

router.get(
  '/:id/artifacts/:artifactId/download',
  validate({ params: schemas.artifactParamsSchema }),
  requirePermission(PERMISSIONS.DOWNLOAD, evidenceResource),
  controller.downloadArtifact,
);

router.post(
  '/:id/seal',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, evidenceResource),
  controller.seal,
);

router.post(
  '/:id/verify',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.VERIFY, evidenceResource),
  controller.verify,
);

router.post(
  '/:id/transfers',
  validate({ params: schemas.evidenceIdParamsSchema, body: schemas.requestTransferBodySchema }),
  requirePermission(PERMISSIONS.EDIT, evidenceResource),
  controller.requestTransfer,
);

// Authorization for these two is fully expressed by "must be the
// pending transfer's to_user_id" (checked in evidence.service.js's
// loadPendingTransferOrThrow) — a resource-INSTANCE-specific check
// stronger than the generic case-role engine can express, so these are
// requireAuth-only rather than requirePermission-gated (mirrors how
// cases.service.js's reopen-authorization also lives inline, beyond the
// route guard).
router.post(
  '/:id/transfers/:transferId/accept',
  requireAuth,
  validate({ params: schemas.transferParamsSchema }),
  controller.acceptTransfer,
);
router.post(
  '/:id/transfers/:transferId/reject',
  requireAuth,
  validate({ params: schemas.transferParamsSchema, body: schemas.rejectTransferBodySchema }),
  controller.rejectTransfer,
);

router.post(
  '/:id/analysis/start',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, evidenceResource),
  controller.startAnalysis,
);
router.post(
  '/:id/analysis/complete',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, evidenceResource),
  controller.completeAnalysis,
);

router.post(
  '/:id/return',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, evidenceResource),
  controller.returnEvidence,
);
router.post(
  '/:id/archive',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.ARCHIVE, evidenceResource),
  controller.archive,
);

router.get(
  '/:id/custody',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, evidenceResource),
  controller.custodyTimeline,
);
router.get(
  '/:id/custody/verify',
  validate({ params: schemas.evidenceIdParamsSchema }),
  requirePermission(PERMISSIONS.VERIFY, evidenceResource),
  controller.verifyCustody,
);

module.exports = router;
