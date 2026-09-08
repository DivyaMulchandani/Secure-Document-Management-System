'use strict';

const repository = require('./audit.repository');
const ledger = require('../../services/ledger');
const { httpError } = require('../../errors');
const { ROLES } = require('@secure-dms/shared');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

/**
 * Read access to the ledger (feature 19 / Role Capability Matrix "Read
 * full audit ledger + export"): ADMINISTRATOR and AUDITOR see
 * everything; INVESTIGATOR is scoped to their own cases' events;
 * FORENSIC_OFFICER/PROSECUTOR have no ledger access at all (matrix: "—").
 */
async function listEvents(requestingUser, filters) {
  const { roles, id: userId } = requestingUser;

  if (roles.includes(ROLES.ADMINISTRATOR) || roles.includes(ROLES.AUDITOR)) {
    return repository.listEvents({ ...filters, caseIds: null });
  }
  if (roles.includes(ROLES.INVESTIGATOR)) {
    const caseIds = await repository.findCaseIdsForUser(userId);
    return repository.listEvents({ ...filters, caseIds });
  }
  throw httpError(403, 'FORBIDDEN', 'You do not have permission to read the audit ledger.');
}

/**
 * Recomputes every stored event's hash from its own row data and
 * confirms previous_hash/event_hash form an unbroken chain — feature 18
 * ("recompute every event_hash"), the Auditor journey's core action.
 * Reuses services/ledger's exact hashing procedure so this can never
 * silently drift out of sync with how hashes are computed on write.
 */
async function verifyChain() {
  const events = await repository.listAllEventsOrdered();

  let previousHash = null;
  for (const event of events) {
    const expectedHash = ledger.computeEventHash({
      actorUserId: event.actor_user_id,
      action: event.action,
      resourceType: event.resource_type,
      resourceId: event.resource_id,
      caseId: event.case_id,
      result: event.result,
      ipAddress: event.ip_address,
      sessionId: event.session_id,
      device: event.device,
      metadata: event.metadata,
      previousHash: event.previous_hash,
      createdAt: event.created_at,
    });

    if (event.previous_hash !== previousHash || event.event_hash !== expectedHash) {
      return { intact: false, brokenAtId: event.id, totalEvents: events.length };
    }
    previousHash = event.event_hash;
  }

  return { intact: true, brokenAtId: null, totalEvents: events.length };
}

const CSV_COLUMNS = [
  'id',
  'created_at',
  'actor_user_id',
  'actor_username',
  'action',
  'resource_type',
  'resource_id',
  'case_id',
  'result',
  'ip_address',
  'session_id',
  'device',
  'metadata',
  'previous_hash',
  'event_hash',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Same scoping/authorization as listEvents (reused), formatted as CSV.
 * Fetches up to a generous page size rather than the paginated default
 * — export is meant to be a full dump of the filtered set.
 */
async function exportCsv(requestingUser, filters) {
  const events = await listEvents(requestingUser, { ...filters, page: 1, pageSize: 10000 });
  const lines = [CSV_COLUMNS.join(',')];
  for (const event of events) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(event[col])).join(','));
  }
  return lines.join('\n');
}

module.exports = { health, listEvents, verifyChain, exportCsv };
