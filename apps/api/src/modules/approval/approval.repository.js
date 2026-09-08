'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns all SQL for `approval_requests` and `approval_steps`.
 * Write-capable functions take an optional trailing `executor = pool`
 * (see db/pool.js's withTransaction convention).
 */

async function healthCheck() {
  return { module: 'approval' };
}

// --- approval_requests -----------------------------------------------

async function insertRequest({ documentId, documentVersionId, requestedBy }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO approval_requests (document_id, document_version_id, requested_by)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [documentId, documentVersionId, requestedBy],
  );
  return rows[0];
}

async function findRequestById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listRequestsForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ar.*, u.username AS requested_by_username
     FROM approval_requests ar
     JOIN users u ON u.id = ar.requested_by
     WHERE ar.document_id = $1
     ORDER BY ar.created_at DESC`,
    [documentId],
  );
  return rows;
}

async function updateRequestStatus({ id, status, currentStep, completedAt = null }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE approval_requests SET status = $1, current_step = $2, completed_at = $3 WHERE id = $4 RETURNING *`,
    [status, currentStep, completedAt, id],
  );
  return rows[0];
}

// --- approval_steps ----------------------------------------------------

async function insertStep({ approvalRequestId, stepOrder, approverId }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO approval_steps (approval_request_id, step_order, approver_id)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [approvalRequestId, stepOrder, approverId],
  );
  return rows[0];
}

async function findStepById(id, executor = pool) {
  const { rows } = await executor.query(
    `SELECT s.*, u.username AS approver_username
     FROM approval_steps s
     JOIN users u ON u.id = s.approver_id
     WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listStepsForRequest(approvalRequestId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT s.*, u.username AS approver_username
     FROM approval_steps s
     JOIN users u ON u.id = s.approver_id
     WHERE s.approval_request_id = $1
     ORDER BY s.step_order ASC`,
    [approvalRequestId],
  );
  return rows;
}

async function updateStepDecision({ id, status, comments = null }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE approval_steps SET status = $1, comments = $2, decided_at = now() WHERE id = $3 RETURNING *`,
    [status, comments, id],
  );
  return rows[0];
}

/** "My turn" inbox: pending steps whose request is still active AND whose step_order is the request's current step — i.e., every step that isn't waiting on someone earlier in the chain. */
async function findPendingStepsForApprover(approverId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT s.*, ar.status AS request_status, d.id AS document_id, d.title AS document_title,
            d.case_id, ru.username AS requested_by_username
     FROM approval_steps s
     JOIN approval_requests ar ON ar.id = s.approval_request_id
     JOIN documents d ON d.id = ar.document_id
     JOIN users ru ON ru.id = ar.requested_by
     WHERE s.approver_id = $1
       AND s.status = 'PENDING'
       AND s.step_order = ar.current_step
       AND ar.status = 'PENDING'
     ORDER BY s.created_at ASC`,
    [approverId],
  );
  return rows;
}

module.exports = {
  healthCheck,
  insertRequest,
  findRequestById,
  listRequestsForDocument,
  updateRequestStatus,
  insertStep,
  findStepById,
  listStepsForRequest,
  updateStepDecision,
  findPendingStepsForApprover,
};
