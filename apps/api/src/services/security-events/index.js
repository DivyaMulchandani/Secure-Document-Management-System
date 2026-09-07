'use strict';

/**
 * feature 20, 22 — the monitored subset of events that raise alerts.
 * Cross-cutting infrastructure like services/ledger: owns its own SQL
 * rather than living inside a module's repository, and is always called
 * with the caller's transaction `client` so it commits atomically with
 * whatever domain write triggered it.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   eventType: string, severity: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
 *   userId?: string|null, resourceType?: string|null,
 *   resourceId?: string|null, description?: string|null,
 * }} event
 * @returns {Promise<{id: string}>}
 */
async function raise(client, event) {
  const {
    rows: [inserted],
  } = await client.query(
    `INSERT INTO security_events
       (event_type, severity, user_id, resource_type, resource_id, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,'OPEN')
     RETURNING id`,
    [
      event.eventType,
      event.severity,
      event.userId ?? null,
      event.resourceType ?? null,
      event.resourceId ?? null,
      event.description ?? null,
    ],
  );
  return { id: inserted.id };
}

module.exports = { raise };
