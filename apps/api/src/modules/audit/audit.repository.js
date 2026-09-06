'use strict';

// const { pool } = require('../../db/pool');

/**
 * STUB — Sprint 0. All SQL for the audit module lives here in later
 * sprints. For now this only backs the stub health route so the
 * controller→service→repository wiring is real end to end.
 */
async function healthCheck() {
  return { module: 'audit' };
}

module.exports = { healthCheck };
