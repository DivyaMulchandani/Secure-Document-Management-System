'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns all SQL for `evidence`, `evidence_artifacts`, and
 * `custody_events`. Write-capable functions take an optional trailing
 * `executor = pool` (see db/pool.js's withTransaction convention).
 */

// --- health (kept from the Sprint 0 stub route) ---------------------------

async function healthCheck() {
  return { module: 'evidence' };
}

// --- evidence numbering -------------------------------------------------

/**
 * @returns {Promise<string>} e.g. "EV-2026-0007-01" for the 1st
 *   evidence item registered against case "CASE-2026-0007" — race-safe
 *   upsert, same pattern as cases.repository.nextCaseNumber.
 */
async function nextEvidenceNumber(caseId, executor = pool) {
  const {
    rows: [caseRow],
  } = await executor.query('SELECT case_number FROM cases WHERE id = $1', [caseId]);
  const caseSuffix = (caseRow.case_number || '').replace(/^CASE-/, '');

  const { rows } = await executor.query(
    `INSERT INTO evidence_counters (case_id, last_sequence)
     VALUES ($1, 1)
     ON CONFLICT (case_id) DO UPDATE SET last_sequence = evidence_counters.last_sequence + 1
     RETURNING last_sequence`,
    [caseId],
  );
  const seq = String(rows[0].last_sequence).padStart(2, '0');
  return `EV-${caseSuffix}-${seq}`;
}

// --- evidence ---------------------------------------------------------

async function insertEvidence(
  { caseId, evidenceNumber, title, description = null, category = null, custodianId, location = null, createdBy },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO evidence
       (case_id, evidence_number, title, description, category, status,
        current_custodian_id, current_location, created_by)
     VALUES ($1,$2,$3,$4,$5,'REGISTERED',$6,$7,$8)
     RETURNING *`,
    [caseId, evidenceNumber, title, description, category, custodianId, location, createdBy],
  );
  return rows[0];
}

async function findEvidenceById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM evidence WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listEvidenceForCase({ caseId, status, page = 1, pageSize = 50 }, executor = pool) {
  const { rows } = await executor.query(
    `SELECT e.*, u.username AS custodian_username
     FROM evidence e
     JOIN users u ON u.id = e.current_custodian_id
     WHERE e.case_id = $1 AND ($2::text IS NULL OR e.status = $2)
     ORDER BY e.created_at DESC
     LIMIT $3 OFFSET $4`,
    [caseId, status || null, pageSize, (page - 1) * pageSize],
  );
  return rows;
}

/**
 * Generic status/custodian/location transition — the service decides
 * which of these actually change for a given action (e.g. a plain SEAL
 * only changes status; a completed RECEIVE changes all three).
 */
async function updateEvidenceState({ id, status, custodianId, location }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE evidence SET
       status = $1,
       current_custodian_id = COALESCE($2, current_custodian_id),
       current_location = COALESCE($3, current_location),
       updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [status, custodianId ?? null, location ?? null, id],
  );
  return rows[0];
}

// --- evidence_artifacts -------------------------------------------------

async function insertArtifact(
  { evidenceId, storageKey, sha256Hash, fileName, mimeType, sizeBytes },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO evidence_artifacts (evidence_id, storage_key, sha256_hash, file_name, mime_type, size_bytes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [evidenceId, storageKey, sha256Hash, fileName, mimeType, sizeBytes],
  );
  return rows[0];
}

async function listArtifactsForEvidence(evidenceId, executor = pool) {
  const { rows } = await executor.query(
    'SELECT * FROM evidence_artifacts WHERE evidence_id = $1 ORDER BY created_at',
    [evidenceId],
  );
  return rows;
}

async function findArtifactById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM evidence_artifacts WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateArtifactIntegrityStatus({ id, status }, executor = pool) {
  await executor.query('UPDATE evidence_artifacts SET integrity_status = $1 WHERE id = $2', [status, id]);
}

// --- custody_events ------------------------------------------------------
// (rows are inserted via services/custody-ledger.appendEvent, which owns
// the hash-chaining — this module only reads them back.)

async function findLatestPendingTransfer(evidenceId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT * FROM custody_events
     WHERE evidence_id = $1 AND action = 'TRANSFER_REQUEST' AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
    [evidenceId],
  );
  return rows[0] || null;
}

async function listCustodyEvents(evidenceId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ce.*, fu.username AS from_username, tu.username AS to_username, cu.username AS created_by_username
     FROM custody_events ce
     LEFT JOIN users fu ON fu.id = ce.from_user_id
     LEFT JOIN users tu ON tu.id = ce.to_user_id
     JOIN users cu ON cu.id = ce.created_by
     WHERE ce.evidence_id = $1
     ORDER BY ce.created_at ASC, ce.id ASC`,
    [evidenceId],
  );
  return rows;
}

module.exports = {
  healthCheck,
  nextEvidenceNumber,
  insertEvidence,
  findEvidenceById,
  listEvidenceForCase,
  updateEvidenceState,
  insertArtifact,
  listArtifactsForEvidence,
  findArtifactById,
  updateArtifactIntegrityStatus,
  findLatestPendingTransfer,
  listCustodyEvents,
};
