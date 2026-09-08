'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns all SQL for `cases` and `case_members`.
 * Write-capable functions take an optional trailing `executor = pool`
 * (see db/pool.js's withTransaction doc comment for the convention).
 */

// --- health (kept from the Sprint 0 stub route) ---------------------------

async function healthCheck() {
  return { module: 'cases' };
}

// --- case numbering ---------------------------------------------------

/**
 * Atomically advances (and returns) the sequence for the given year via
 * an upsert — race-safe under concurrent case creation without needing
 * an explicit lock.
 * @returns {Promise<string>} e.g. "CASE-2026-0007"
 */
async function nextCaseNumber(executor = pool) {
  const year = new Date().getFullYear();
  const { rows } = await executor.query(
    `INSERT INTO case_number_counters (year, last_sequence)
     VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_sequence = case_number_counters.last_sequence + 1
     RETURNING last_sequence`,
    [year],
  );
  const seq = String(rows[0].last_sequence).padStart(4, '0');
  return `CASE-${year}-${seq}`;
}

// --- cases ---------------------------------------------------------------

async function insertCase(
  { caseNumber, title, description = null, priority, ownerId, departmentId = null },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO cases (case_number, title, description, priority, owner_id, department_id, opened_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     RETURNING *`,
    [caseNumber, title, description, priority, ownerId, departmentId],
  );
  return rows[0];
}

async function findCaseById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM cases WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * @param {{userId: string, isPrivileged: boolean, status?: string,
 *   priority?: string, departmentId?: string, page?: number, pageSize?: number}} params
 *   `isPrivileged` (ADMINISTRATOR/AUDITOR) sees every case; everyone
 *   else sees only cases they're an active member of.
 */
async function listCases(
  { userId, isPrivileged, status, priority, departmentId, page = 1, pageSize = 20 },
  executor = pool,
) {
  const conditions = [];
  const params = [];

  if (!isPrivileged) {
    params.push(userId);
    conditions.push(
      `c.id IN (SELECT case_id FROM case_members WHERE user_id = $${params.length} AND revoked_at IS NULL)`,
    );
  }
  if (status) {
    params.push(status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`c.priority = $${params.length}`);
  }
  if (departmentId) {
    params.push(departmentId);
    conditions.push(`c.department_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(pageSize, (page - 1) * pageSize);

  const { rows } = await executor.query(
    `SELECT c.*, u.username AS owner_username, d.name AS department_name
     FROM cases c
     JOIN users u ON u.id = c.owner_id
     LEFT JOIN departments d ON d.id = c.department_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

async function updateCase({ id, title, description, priority, departmentId }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE cases SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       priority = COALESCE($3, priority),
       department_id = COALESCE($4, department_id),
       updated_at = now()
     WHERE id = $5
     RETURNING *`,
    [title ?? null, description ?? null, priority ?? null, departmentId ?? null, id],
  );
  return rows[0];
}

/**
 * `closedAt`/`archivedAt` are set EXACTLY to whatever the service
 * passes (not COALESCEd) — the service is responsible for computing
 * the correct final value for each (a timestamp, null to clear on
 * reopen, or the existing row's own value to leave it untouched).
 */
async function updateCaseStatus({ id, status, closedAt, archivedAt }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE cases SET
       status = $1,
       closed_at = $2,
       archived_at = $3,
       updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [status, closedAt, archivedAt, id],
  );
  return rows[0];
}

// --- case_members ---------------------------------------------------------

async function insertCaseMember({ caseId, userId, caseRole, addedBy = null }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO case_members (case_id, user_id, case_role, added_by)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [caseId, userId, caseRole, addedBy],
  );
  return rows[0];
}

async function findActiveCaseMember({ caseId, userId }, executor = pool) {
  const { rows } = await executor.query(
    'SELECT * FROM case_members WHERE case_id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [caseId, userId],
  );
  return rows[0] || null;
}

async function listCaseMembers(caseId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT cm.id, cm.case_id, cm.user_id, cm.case_role, cm.joined_at, cm.revoked_at,
            u.username, u.full_name
     FROM case_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.case_id = $1 AND cm.revoked_at IS NULL
     ORDER BY cm.joined_at`,
    [caseId],
  );
  return rows;
}

async function countActiveMembersByRole(caseId, caseRole, executor = pool) {
  const { rows } = await executor.query(
    `SELECT count(*)::int AS count FROM case_members
     WHERE case_id = $1 AND case_role = $2 AND revoked_at IS NULL`,
    [caseId, caseRole],
  );
  return rows[0].count;
}

async function revokeCaseMember({ caseId, userId }, executor = pool) {
  await executor.query(
    `UPDATE case_members SET revoked_at = now()
     WHERE case_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [caseId, userId],
  );
}

module.exports = {
  healthCheck,
  nextCaseNumber,
  insertCase,
  findCaseById,
  listCases,
  updateCase,
  updateCaseStatus,
  insertCaseMember,
  findActiveCaseMember,
  listCaseMembers,
  countActiveMembersByRole,
  revokeCaseMember,
};
