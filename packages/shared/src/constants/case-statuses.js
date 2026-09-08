'use strict';

/**
 * cases.status — the CASE lifecycle state machine.
 * @see docs/architecture — "Lifecycle state machines · CASE"
 *
 * Legal transitions (enforced in cases.service.js):
 *   OPEN -> UNDER_INVESTIGATION
 *   UNDER_INVESTIGATION -> UNDER_REVIEW
 *   UNDER_REVIEW -> SUBMITTED
 *   SUBMITTED -> CLOSED
 *   CLOSED -> ARCHIVED
 *   CLOSED -> UNDER_INVESTIGATION   (reopen — authorized/admin only)
 */
const CASE_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  UNDER_INVESTIGATION: 'UNDER_INVESTIGATION',
  UNDER_REVIEW: 'UNDER_REVIEW',
  SUBMITTED: 'SUBMITTED',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
});

const CASE_STATUS_LIST = Object.freeze(Object.values(CASE_STATUSES));

module.exports = { CASE_STATUSES, CASE_STATUS_LIST };
