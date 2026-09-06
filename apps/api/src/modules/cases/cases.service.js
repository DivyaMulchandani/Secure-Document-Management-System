'use strict';

const repository = require('./cases.repository');

/**
 * STUB — Sprint 0. Business logic for the cases module is assembled
 * here in later sprints, following the golden path: authenticate ->
 * authorize -> this service -> persistence+storage -> audit ledger
 * append, all inside one DB transaction. Only a health stub exists now.
 */
async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

module.exports = { health };
