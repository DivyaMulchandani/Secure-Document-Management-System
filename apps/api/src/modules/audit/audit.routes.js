'use strict';

const express = require('express');
const { ROLES } = require('@secure-dms/shared');
const controller = require('./audit.controller');
const validate = require('../../middleware/validate');
const requireRole = require('../../middleware/require-role');
const schemas = require('./audit.validation');

const router = express.Router();

router.get('/health', controller.getHealth);

// Service further scopes INVESTIGATOR to their own cases; FORENSIC/
// PROSECUTOR have no ledger read access at all (matrix: "—") and are
// rejected inside the service, not here, so the 403 message can be
// specific rather than a generic route-guard rejection.
router.get(
  '/',
  requireRole(ROLES.ADMINISTRATOR, ROLES.AUDITOR, ROLES.INVESTIGATOR),
  validate({ query: schemas.listEventsQuerySchema }),
  controller.list,
);

// Chain verification and CSV export are oversight actions — matrix's
// "Read full audit ledger + export" is unconditionally full (⬤) only
// for ADMINISTRATOR/AUDITOR, so both are restricted to those two roles.
router.get('/verify', requireRole(ROLES.ADMINISTRATOR, ROLES.AUDITOR), controller.verify);
router.get(
  '/export',
  requireRole(ROLES.ADMINISTRATOR, ROLES.AUDITOR),
  validate({ query: schemas.listEventsQuerySchema }),
  controller.exportCsv,
);

module.exports = router;
