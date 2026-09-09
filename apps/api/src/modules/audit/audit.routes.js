'use strict';

const express = require('express');
const { AUDIT_ROLES, CASE_CREATOR_ROLES } = require('@secure-dms/shared');
const controller = require('./audit.controller');
const validate = require('../../middleware/validate');
const requireRole = require('../../middleware/require-role');
const schemas = require('./audit.validation');

const router = express.Router();

router.get('/health', controller.getHealth);

// Service further scopes non-oversight roles to their own cases; the
// external tier (courts/prosecution/labs) has no ledger read access at
// all and is rejected inside the service, not here, so the 403 message
// can be specific rather than a generic route-guard rejection.
router.get(
  '/',
  requireRole(...AUDIT_ROLES, ...CASE_CREATOR_ROLES),
  validate({ query: schemas.listEventsQuerySchema }),
  controller.list,
);

// Chain verification and CSV export are oversight-only actions —
// unconditionally full ledger read + export is restricted to the audit
// tier (STATE_HQ_ADMIN, ADMINISTRATION_HQ_ADMIN/OFFICER — Internal Audit).
router.get('/verify', requireRole(...AUDIT_ROLES), controller.verify);
router.get(
  '/export',
  requireRole(...AUDIT_ROLES),
  validate({ query: schemas.listEventsQuerySchema }),
  controller.exportCsv,
);

module.exports = router;
