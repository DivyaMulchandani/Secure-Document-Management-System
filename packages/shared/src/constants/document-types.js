'use strict';

/**
 * The fixed catalogue of legal document kinds (feature 4, 8). Mirrors
 * the `document_types` table seed data
 * (apps/api/migrations/*_seed-document-types.js) — keep in sync manually.
 * @see docs/architecture — "Domain · Documents & AI enrichment"
 */
const DOCUMENT_TYPES = Object.freeze({
  FIR: 'FIR',
  WITNESS_STATEMENT: 'WITNESS_STATEMENT',
  INVESTIGATION_REPORT: 'INVESTIGATION_REPORT',
  CHARGE_SHEET: 'CHARGE_SHEET',
  COURT_FILING: 'COURT_FILING',
  FORENSIC_REPORT: 'FORENSIC_REPORT',
  EVIDENCE_RECORD: 'EVIDENCE_RECORD',
  LEGAL_NOTICE: 'LEGAL_NOTICE',
  JUDGMENT_ORDER: 'JUDGMENT_ORDER',
});

const DOCUMENT_TYPE_LIST = Object.freeze(Object.values(DOCUMENT_TYPES));

module.exports = { DOCUMENT_TYPES, DOCUMENT_TYPE_LIST };
