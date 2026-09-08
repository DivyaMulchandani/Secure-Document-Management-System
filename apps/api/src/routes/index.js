'use strict';

const express = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const usersRoutes = require('../modules/users/users.routes');
const casesRoutes = require('../modules/cases/cases.routes');
const documentsRoutes = require('../modules/documents/documents.routes');
const permissionsRoutes = require('../modules/permissions/permissions.routes');
const auditRoutes = require('../modules/audit/audit.routes');
const evidenceRoutes = require('../modules/evidence/evidence.routes');
const signaturesRoutes = require('../modules/signatures/signatures.routes');
const verificationRoutes = require('../modules/verification/verification.routes');
const sharingRoutes = require('../modules/sharing/sharing.routes');
const approvalRoutes = require('../modules/approval/approval.routes');

/** Aggregates every module router under /api/v1. Mounted in app.js. */
const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/cases', casesRoutes);
router.use('/documents', documentsRoutes);
router.use('/permissions', permissionsRoutes);
router.use('/audit', auditRoutes);
router.use('/evidence', evidenceRoutes);
router.use('/signatures', signaturesRoutes);
router.use('/verification', verificationRoutes);
router.use('/sharing', sharingRoutes);
router.use('/approval', approvalRoutes);

module.exports = router;
