'use strict';

const crypto = require('crypto');

/**
 * Real implementation of the hash-chained, append-only audit ledger
 * (feature 9, 14, 18, 19 — docs/architecture "Feature flow · Hash-chained
 * audit ledger"). Every row's event_hash = SHA-256(canonical event JSON +
 * previous_hash); tampering with any past row breaks every hash after it.
 *
 * Fixed advisory-lock key reserved solely for the audit hash chain —
 * transaction-scoped (auto-released at COMMIT/ROLLBACK), cheap insurance
 * against a hash-chain race between concurrent writers appending at once.
 */
const LEDGER_LOCK_KEY = 727100001;

/**
 * Recursively sorts object keys so JSON.stringify produces a
 * deterministic byte sequence regardless of property insertion order —
 * required so the hash is reproducible from the same logical event.
 */
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
 * Appends one hash-chained event. MUST be called with the same `client`
 * (from db/pool.js's withTransaction) that performed the domain write
 * this event describes — the golden path requires both to commit
 * together or not at all.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   actorUserId?: string|null, action: string, resourceType: string,
 *   resourceId?: string|null, caseId?: string|null,
 *   result: 'SUCCESS'|'FAILURE', ipAddress?: string|null,
 *   sessionId?: string|null, device?: string|null, metadata?: object,
 * }} event
 * @returns {Promise<{id: string, eventHash: string}>}
 */
async function appendEvent(client, event) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK_KEY]);

  const {
    rows: [lastRow],
  } = await client.query('SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1');
  const previousHash = lastRow ? lastRow.event_hash : null;

  // Computed once in JS so the exact same value is used both inside the
  // hash input and the INSERT — never rely on the DB's now() default
  // here, or the stored hash wouldn't match what's actually stored.
  const createdAt = new Date();

  const canonical = sortKeysDeep({
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    caseId: event.caseId ?? null,
    result: event.result,
    ipAddress: event.ipAddress ?? null,
    sessionId: event.sessionId ?? null,
    device: event.device ?? null,
    metadata: event.metadata ?? {},
    previousHash,
    createdAt: createdAt.toISOString(),
  });
  const canonicalJson = JSON.stringify(canonical);
  const eventHash = crypto.createHash('sha256').update(canonicalJson).digest('hex');

  const {
    rows: [inserted],
  } = await client.query(
    `INSERT INTO audit_events
       (actor_user_id, action, resource_type, resource_id, case_id, result,
        ip_address, session_id, device, metadata, previous_hash, event_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, event_hash`,
    [
      event.actorUserId ?? null,
      event.action,
      event.resourceType,
      event.resourceId ?? null,
      event.caseId ?? null,
      event.result,
      event.ipAddress ?? null,
      event.sessionId ?? null,
      event.device ?? null,
      JSON.stringify(event.metadata ?? {}),
      previousHash,
      eventHash,
      createdAt,
    ],
  );

  return { id: inserted.id, eventHash: inserted.event_hash };
}

module.exports = { appendEvent, LEDGER_LOCK_KEY };
