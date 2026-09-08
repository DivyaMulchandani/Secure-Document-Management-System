'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns SQL for `document_shares` only — the actual access-control write
 * (resource_permissions) belongs to, and is reused from,
 * permissions.repository.js (see sharing.service.js). Live share status
 * (ACTIVE/EXPIRED/REVOKED) is always computed here by joining
 * resource_permissions, never duplicated onto this table — see the
 * migration's header comment for why.
 */

async function healthCheck() {
  return { module: 'sharing' };
}

async function insertShare(
  { documentId, resourcePermissionId, sharedBy, sharedWith, permissionCode, reason = null, expiresAt },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO document_shares
       (document_id, resource_permission_id, shared_by, shared_with, permission_code, reason, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [documentId, resourcePermissionId, sharedBy, sharedWith, permissionCode, reason, expiresAt],
  );
  return rows[0];
}

const STATUS_EXPR = `
  CASE
    WHEN rp.revoked_at IS NOT NULL THEN 'REVOKED'
    WHEN rp.expires_at <= now() THEN 'EXPIRED'
    ELSE 'ACTIVE'
  END AS status
`;

async function findShareById(id, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, ${STATUS_EXPR}
     FROM document_shares ds
     JOIN resource_permissions rp ON rp.id = ds.resource_permission_id
     WHERE ds.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listSharesForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, ${STATUS_EXPR},
            su.username AS shared_by_username, wu.username AS shared_with_username
     FROM document_shares ds
     JOIN resource_permissions rp ON rp.id = ds.resource_permission_id
     JOIN users su ON su.id = ds.shared_by
     JOIN users wu ON wu.id = ds.shared_with
     WHERE ds.document_id = $1
     ORDER BY ds.created_at DESC`,
    [documentId],
  );
  return rows;
}

/** "Shared with me" — across every case, not just ones the recipient is otherwise a member of (that's the whole point of a share). */
async function listSharesForRecipient(userId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, ${STATUS_EXPR},
            su.username AS shared_by_username, d.title AS document_title, d.case_id
     FROM document_shares ds
     JOIN resource_permissions rp ON rp.id = ds.resource_permission_id
     JOIN users su ON su.id = ds.shared_by
     JOIN documents d ON d.id = ds.document_id
     WHERE ds.shared_with = $1
     ORDER BY ds.created_at DESC`,
    [userId],
  );
  return rows;
}

module.exports = { healthCheck, insertShare, findShareById, listSharesForDocument, listSharesForRecipient };
