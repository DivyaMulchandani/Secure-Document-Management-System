'use strict';

/**
 * STUB — Sprint 0.
 *
 * Real implementation appends a hash-chained row to `audit_events`
 * (previous_hash -> event_hash) inside the SAME Postgres transaction as
 * the domain write that triggered it (the "golden path"). Lands once
 * the audit_events table exists and the audit module has real logic.
 */
async function appendEvent(/* dbClient, event */) {
  throw new Error('ledger.appendEvent is not implemented yet (Sprint 0 stub)');
}

module.exports = { appendEvent };
