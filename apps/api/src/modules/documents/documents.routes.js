'use strict';

const express = require('express');
const { PERMISSIONS } = require('@secure-dms/shared');
const controller = require('./documents.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const requirePermission = require('../../middleware/require-permission');
const { uploadSingleFile } = require('../../middleware/upload');
const schemas = require('./documents.validation');

const router = express.Router();

const documentResource = (req) => ({ type: 'DOCUMENT', id: req.params.id });
const caseResourceFromBody = (req) => ({ type: 'CASE', id: req.body.caseId });
const caseResourceFromQuery = (req) => ({ type: 'CASE', id: req.query.caseId });

// Route ordering matters: literal-segment paths ("/health", "/types")
// MUST be declared before the generic "/:id" route below, same
// collision reasoning as users.routes.js's "/departments" vs "/:id".

router.get('/health', controller.getHealth);
router.get('/types', requireAuth, controller.listTypes);

// multer runs first — it's what actually parses multipart/form-data and
// populates req.body (non-file fields) + req.file (the upload), so
// validate() and requirePermission() (which reads req.body.caseId) both
// depend on it having already run.
router.post(
  '/',
  uploadSingleFile('file'),
  validate({ body: schemas.createDocumentBodySchema }),
  requirePermission(PERMISSIONS.UPLOAD, caseResourceFromBody),
  controller.create,
);

router.get(
  '/',
  validate({ query: schemas.listDocumentsQuerySchema }),
  requirePermission(PERMISSIONS.VIEW, caseResourceFromQuery),
  controller.list,
);

router.get(
  '/:id',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, documentResource),
  controller.getById,
);

router.patch(
  '/:id',
  validate({ params: schemas.documentIdParamsSchema, body: schemas.updateDocumentBodySchema }),
  requirePermission(PERMISSIONS.EDIT, documentResource),
  controller.update,
);

router.delete(
  '/:id',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.DELETE, documentResource),
  controller.remove,
);

router.get(
  '/:id/download',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.DOWNLOAD, documentResource),
  controller.downloadCurrent,
);

// Unlike POST / above, the resource here (an existing document) is
// identifiable from req.params.id alone, so authorization can run
// BEFORE multer buffers the upload — an unauthorized caller's file
// never gets accepted/held in memory at all.
router.post(
  '/:id/versions',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.UPLOAD, documentResource),
  uploadSingleFile('file'),
  validate({ body: schemas.newVersionBodySchema }),
  controller.addVersion,
);

router.get(
  '/:id/versions',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, documentResource),
  controller.listVersions,
);

router.get(
  '/:id/versions/:versionId/download',
  validate({ params: schemas.versionParamsSchema }),
  requirePermission(PERMISSIONS.DOWNLOAD, documentResource),
  controller.downloadVersion,
);

router.post(
  '/:id/versions/:versionId/restore',
  validate({ params: schemas.versionParamsSchema }),
  requirePermission(PERMISSIONS.EDIT, documentResource),
  controller.restoreVersion,
);

router.post(
  '/:id/comments',
  validate({ params: schemas.documentIdParamsSchema, body: schemas.addCommentBodySchema }),
  requirePermission(PERMISSIONS.COMMENT, documentResource),
  controller.addComment,
);

router.get(
  '/:id/comments',
  validate({ params: schemas.documentIdParamsSchema }),
  requirePermission(PERMISSIONS.VIEW, documentResource),
  controller.listComments,
);

module.exports = router;
