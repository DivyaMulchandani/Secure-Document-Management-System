'use strict';

const { pool } = require('../../db/pool');

/** Owns all SQL for `verification_records`. */

async function healthCheck() {
  return { module: 'verification' };
}

async function insertRecord(
  {
    documentId,
    documentSignatureId,
    verifiedBy = null,
    hashCheck,
    signatureCheck,
    ledgerCheck,
    versionCheck,
    overallResult,
    source,
    ipAddress = null,
  },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO verification_records
       (document_id, document_signature_id, verified_by, hash_check, signature_check,
        ledger_check, version_check, overall_result, source, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      documentId,
      documentSignatureId,
      verifiedBy,
      hashCheck,
      signatureCheck,
      ledgerCheck,
      versionCheck,
      overallResult,
      source,
      ipAddress,
    ],
  );
  return rows[0];
}

async function listForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT vr.*, u.username AS verified_by_username
     FROM verification_records vr
     LEFT JOIN users u ON u.id = vr.verified_by
     WHERE vr.document_id = $1
     ORDER BY vr.created_at DESC`,
    [documentId],
  );
  return rows;
}

module.exports = { healthCheck, insertRecord, listForDocument };
