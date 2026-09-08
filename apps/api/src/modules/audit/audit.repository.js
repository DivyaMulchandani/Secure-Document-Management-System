'use strict';

const { pool } = require('../../db/pool');

async function healthCheck() {
  return { module: 'audit' };
}

/**
 * Every filter is optional — the `$n::type IS NULL OR column = $n`
 * pattern lets every clause be present in the query text unconditionally
 * (no dynamic SQL string-building) while still being a no-op when the
 * caller passes null for it.
 *
 * `caseIds`: pass `null` for unrestricted (ADMINISTRATOR/AUDITOR); pass
 * an array (possibly empty) to scope results to those case ids only
 * (INVESTIGATOR — an empty array correctly yields zero rows, not "no
 * restriction").
 */
async function listEvents(
  {
    actorUserId = null,
    action = null,
    resourceType = null,
    resourceId = null,
    result = null,
    dateFrom = null,
    dateTo = null,
    caseIds = null,
    page = 1,
    pageSize = 50,
  },
  executor = pool,
) {
  const { rows } = await executor.query(
    `SELECT ae.*, u.username AS actor_username
     FROM audit_events ae
     LEFT JOIN users u ON u.id = ae.actor_user_id
     WHERE ($1::uuid IS NULL OR ae.actor_user_id = $1)
       AND ($2::text IS NULL OR ae.action = $2)
       AND ($3::text IS NULL OR ae.resource_type = $3)
       AND ($4::uuid IS NULL OR ae.resource_id = $4)
       AND ($5::text IS NULL OR ae.result = $5)
       AND ($6::timestamptz IS NULL OR ae.created_at >= $6)
       AND ($7::timestamptz IS NULL OR ae.created_at <= $7)
       AND ($8::uuid[] IS NULL OR ae.case_id = ANY($8))
     ORDER BY ae.id DESC
     LIMIT $9 OFFSET $10`,
    [
      actorUserId,
      action,
      resourceType,
      resourceId,
      result,
      dateFrom,
      dateTo,
      caseIds,
      pageSize,
      (page - 1) * pageSize,
    ],
  );
  return rows;
}

/**
 * Full chain, oldest first — what services/ledger's chain-verification
 * needs to recompute every hash in order.
 */
async function listAllEventsOrdered(executor = pool) {
  const { rows } = await executor.query('SELECT * FROM audit_events ORDER BY id ASC');
  return rows;
}

/**
 * Active (unrevoked) case ids the given user is a member of — used to
 * scope an INVESTIGATOR's audit-ledger visibility to "own cases" per
 * the Role Capability Matrix.
 */
async function findCaseIdsForUser(userId, executor = pool) {
  const { rows } = await executor.query(
    'SELECT case_id FROM case_members WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rows.map((r) => r.case_id);
}

module.exports = { healthCheck, listEvents, listAllEventsOrdered, findCaseIdsForUser };
