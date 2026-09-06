'use strict';

const express = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const usersRoutes = require('../modules/users/users.routes');
const casesRoutes = require('../modules/cases/cases.routes');
const documentsRoutes = require('../modules/documents/documents.routes');
const permissionsRoutes = require('../modules/permissions/permissions.routes');
const auditRoutes = require('../modules/audit/audit.routes');

/**
 * Aggregates every P0 module router under /api/v1. Mounted in app.js.
 * P1 modules (evidence, signatures, sharing, verification, approval)
 * are added here unchanged when those sprints start.
 */
const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/cases', casesRoutes);
router.use('/documents', documentsRoutes);
router.use('/permissions', permissionsRoutes);
router.use('/audit', auditRoutes);

module.exports = router;
