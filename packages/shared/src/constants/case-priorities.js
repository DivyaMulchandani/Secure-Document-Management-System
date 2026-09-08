'use strict';

/**
 * cases.priority
 * @see docs/architecture — "Domain · Cases" (cases table field spec)
 */
const CASE_PRIORITIES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

const CASE_PRIORITY_LIST = Object.freeze(Object.values(CASE_PRIORITIES));

module.exports = { CASE_PRIORITIES, CASE_PRIORITY_LIST };
