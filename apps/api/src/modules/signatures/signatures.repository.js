'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns all SQL for `user_keys` and `document_signatures`.
 * Write-capable functions take an optional trailing `executor = pool`
 * (see db/pool.js's withTransaction convention).
 */

// --- health (kept from the Sprint 0 stub route) ---------------------------

async function healthCheck() {
  return { module: 'signatures' };
}

// --- user_keys -----------------------------------------------------------

async function insertUserKey(
  { userId, publicKey, privateKeyEnvelope, keyId, fingerprint },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO user_keys (user_id, public_key, private_key_envelope, key_id, fingerprint)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [userId, publicKey, privateKeyEnvelope, keyId, fingerprint],
  );
  return rows[0];
}

/** Rotation: retires whatever key is currently ACTIVE for this user (if any) before a new one is inserted. */
async function revokeActiveUserKey(userId, executor = pool) {
  await executor.query(
    `UPDATE user_keys SET status = 'REVOKED', revoked_at = now() WHERE user_id = $1 AND status = 'ACTIVE'`,
    [userId],
  );
}

async function findActiveUserKey(userId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT * FROM user_keys WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function findUserKeyById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM user_keys WHERE id = $1', [id]);
  return rows[0] || null;
}

// --- document_signatures ---------------------------------------------------

/**
 * One row covers both shapes: a self-initiated signature is inserted
 * already SIGNED (signature/signedHash/userKeyId/verificationCode/
 * signedAt all populated); a requested signature is inserted PENDING
 * (those columns null, filled in later by fulfillSignature).
 */
async function insertSignature(
  {
    documentId,
    documentVersionId,
    signerId,
    requestedBy = null,
    status,
    reason = null,
    userKeyId = null,
    signedHash = null,
    signature = null,
    verificationCode = null,
    signedAt = null,
  },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO document_signatures
       (document_id, document_version_id, signer_id, requested_by, status, reason,
        user_key_id, signed_hash, signature, verification_code, signed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      documentId,
      documentVersionId,
      signerId,
      requestedBy,
      status,
      reason,
      userKeyId,
      signedHash,
      signature,
      verificationCode,
      signedAt,
    ],
  );
  return rows[0];
}

async function findSignatureById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM document_signatures WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findSignatureByVerificationCode(code, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, u.username AS signer_username
     FROM document_signatures ds
     JOIN users u ON u.id = ds.signer_id
     WHERE ds.verification_code = $1`,
    [code],
  );
  return rows[0] || null;
}

/** Most recently SIGNED signature for a document, regardless of which version it was signed against — callers decide whether that version is still current (version_check). */
async function findLatestSignedForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, u.username AS signer_username
     FROM document_signatures ds
     JOIN users u ON u.id = ds.signer_id
     WHERE ds.document_id = $1 AND ds.status = 'SIGNED'
     ORDER BY ds.signed_at DESC LIMIT 1`,
    [documentId],
  );
  return rows[0] || null;
}

async function listSignaturesForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, su.username AS signer_username, ru.username AS requested_by_username
     FROM document_signatures ds
     JOIN users su ON su.id = ds.signer_id
     LEFT JOIN users ru ON ru.id = ds.requested_by
     WHERE ds.document_id = $1
     ORDER BY ds.created_at DESC`,
    [documentId],
  );
  return rows;
}

/** The pending-signature queue: everything awaiting this user's decision, newest request first. */
async function listPendingForSigner(signerId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ds.*, d.title AS document_title, d.case_id, ru.username AS requested_by_username
     FROM document_signatures ds
     JOIN documents d ON d.id = ds.document_id
     LEFT JOIN users ru ON ru.id = ds.requested_by
     WHERE ds.signer_id = $1 AND ds.status = 'PENDING'
     ORDER BY ds.created_at DESC`,
    [signerId],
  );
  return rows;
}

async function fulfillSignature(
  { id, userKeyId, signedHash, signature, verificationCode },
  executor = pool,
) {
  const { rows } = await executor.query(
    `UPDATE document_signatures SET
       status = 'SIGNED', user_key_id = $1, signed_hash = $2, signature = $3,
       verification_code = $4, signed_at = now()
     WHERE id = $5 AND status = 'PENDING'
     RETURNING *`,
    [userKeyId, signedHash, signature, verificationCode, id],
  );
  return rows[0] || null;
}

async function declineSignature({ id, declineReason }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE document_signatures SET status = 'DECLINED', decline_reason = $1
     WHERE id = $2 AND status = 'PENDING'
     RETURNING *`,
    [declineReason, id],
  );
  return rows[0] || null;
}

module.exports = {
  healthCheck,
  insertUserKey,
  revokeActiveUserKey,
  findActiveUserKey,
  findUserKeyById,
  insertSignature,
  findSignatureById,
  findSignatureByVerificationCode,
  findLatestSignedForDocument,
  listSignaturesForDocument,
  listPendingForSigner,
  fulfillSignature,
  declineSignature,
};
