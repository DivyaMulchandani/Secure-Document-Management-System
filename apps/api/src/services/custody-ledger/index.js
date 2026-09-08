'use strict';

const crypto = require('crypto');

/**
 * The chain-of-custody ledger (feature 13 — docs/architecture "Digital
 * Chain of Custody": "tamper-evident custody records"). Structurally
 * identical in spirit to services/ledger (SHA-256, previous_hash ->
 * event_hash), but deliberately a SEPARATE chain, scoped PER EVIDENCE
 * ITEM rather than global — each piece of evidence's custody trail is
 * its own tamper-evident sequence, not interleaved with every other
 * evidence's movements or with the system-wide audit_events ledger.
 * Every custody-changing action ALSO appends to the global
 * services/ledger separately (the golden path) — a transfer produces
 * BOTH a custody_events row (this ledger) and an audit_events row.
 *
 * Fixed two-part advisory lock namespace: (CUSTODY_LOCK_NAMESPACE,
 * hashtext(evidenceId)) serializes writers PER EVIDENCE ITEM rather
 * than system-wide, unlike the single global key services/ledger uses
 * — evidence items are independent chains, so there's no need to
 * serialize unrelated evidence's custody writes against each other.
 */
const CUSTODY_LOCK_NAMESPACE = 727100002;

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Exported so evidence.service.js's custody-chain verification can
 * recompute the same hash from a stored row and compare — never lets
 * write and verify drift apart.
 */
function computeEventHash(event) {
  const canonical = sortKeysDeep({
    evidenceId: event.evidenceId,
    fromUserId: event.fromUserId ?? null,
    toUserId: event.toUserId ?? null,
    action: event.action,
    reason: event.reason ?? null,
    status: event.status,
    integrityVerified: !!event.integrityVerified,
    fromLocation: event.fromLocation ?? null,
    toLocation: event.toLocation ?? null,
    previousHash: event.previousHash ?? null,
    createdBy: event.createdBy,
    createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Appends one hash-chained custody event. MUST be called with the same
 * `client` (from db/pool.js's withTransaction) that performed the
 * domain write (evidence.status update etc.) this event describes.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   evidenceId: string, fromUserId?: string|null, toUserId?: string|null,
 *   action: 'REGISTER'|'SEAL'|'TRANSFER_REQUEST'|'RECEIVE'|'ANALYZE'|'RETURN'|'ARCHIVE',
 *   reason?: string|null, status: 'PENDING'|'ACKNOWLEDGED'|'COMPLETED'|'REJECTED',
 *   integrityVerified?: boolean, fromLocation?: string|null, toLocation?: string|null,
 *   createdBy: string,
 * }} event
 * @returns {Promise<{id: string, eventHash: string}>}
 */
async function appendEvent(client, event) {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
    CUSTODY_LOCK_NAMESPACE,
    event.evidenceId,
  ]);

  const {
    rows: [lastRow],
  } = await client.query(
    `SELECT event_hash FROM custody_events
     WHERE evidence_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [event.evidenceId],
  );
  const previousHash = lastRow ? lastRow.event_hash : null;
  const createdAt = new Date();

  const eventHash = computeEventHash({ ...event, previousHash, createdAt });

  const {
    rows: [inserted],
  } = await client.query(
    `INSERT INTO custody_events
       (evidence_id, from_user_id, to_user_id, action, reason, status,
        integrity_verified, from_location, to_location, previous_hash, event_hash,
        created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, event_hash`,
    [
      event.evidenceId,
      event.fromUserId ?? null,
      event.toUserId ?? null,
      event.action,
      event.reason ?? null,
      event.status,
      !!event.integrityVerified,
      event.fromLocation ?? null,
      event.toLocation ?? null,
      previousHash,
      eventHash,
      event.createdBy,
      createdAt,
    ],
  );

  return { id: inserted.id, eventHash: inserted.event_hash };
}

/**
 * Recomputes every stored custody event's hash for one evidence item
 * (oldest first) and confirms the chain is unbroken — the custody
 * analogue of audit.service.verifyChain.
 * @param {import('pg').Pool|import('pg').PoolClient} executor
 * @param {string} evidenceId
 */
async function verifyChain(executor, evidenceId) {
  const { rows } = await executor.query(
    'SELECT * FROM custody_events WHERE evidence_id = $1 ORDER BY created_at ASC, id ASC',
    [evidenceId],
  );

  let previousHash = null;
  for (const row of rows) {
    const expectedHash = computeEventHash({
      evidenceId: row.evidence_id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      action: row.action,
      reason: row.reason,
      status: row.status,
      integrityVerified: row.integrity_verified,
      fromLocation: row.from_location,
      toLocation: row.to_location,
      previousHash: row.previous_hash,
      createdBy: row.created_by,
      createdAt: row.created_at,
    });
    if (row.previous_hash !== previousHash || row.event_hash !== expectedHash) {
      return { intact: false, brokenAtId: row.id, totalEvents: rows.length };
    }
    previousHash = row.event_hash;
  }
  return { intact: true, brokenAtId: null, totalEvents: rows.length };
}

module.exports = { appendEvent, computeEventHash, verifyChain, CUSTODY_LOCK_NAMESPACE };
