'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns all SQL for `documents`, `document_versions`, and
 * `document_comments`. Write-capable functions take an optional
 * trailing `executor = pool` (see db/pool.js's withTransaction
 * convention).
 */

// --- health (kept from the Sprint 0 stub route) ---------------------------

async function healthCheck() {
  return { module: 'documents' };
}

// --- reference data ---------------------------------------------------

async function listDocumentTypes(executor = pool) {
  const { rows } = await executor.query('SELECT * FROM document_types ORDER BY name');
  return rows;
}

// --- documents -------------------------------------------------------

async function insertDocument(
  { caseId, documentTypeId = null, title, description = null, ownerId, status = 'ACTIVE' },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO documents (case_id, document_type_id, title, description, owner_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [caseId, documentTypeId, title, description, ownerId, status],
  );
  return rows[0];
}

async function findDocumentById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * List, joined with the current version's summary fields (so a list
 * view doesn't need N+1 requests to show file name/size/integrity).
 */
async function listDocumentsForCase({ caseId, status = null, page = 1, pageSize = 50 }, executor = pool) {
  const { rows } = await executor.query(
    `SELECT d.*, dt.code AS document_type_code, dt.name AS document_type_name,
            dv.version_number AS current_version_number, dv.file_name AS current_file_name,
            dv.mime_type AS current_mime_type, dv.size_bytes AS current_size_bytes,
            dv.integrity_status AS current_integrity_status, dv.sha256_hash AS current_sha256_hash
     FROM documents d
     LEFT JOIN document_types dt ON dt.id = d.document_type_id
     LEFT JOIN document_versions dv ON dv.id = d.current_version_id
     WHERE d.case_id = $1 AND ($2::text IS NULL OR d.status = $2)
     ORDER BY d.created_at DESC
     LIMIT $3 OFFSET $4`,
    [caseId, status, pageSize, (page - 1) * pageSize],
  );
  return rows;
}

async function updateDocumentCurrentVersion({ id, versionId }, executor = pool) {
  await executor.query('UPDATE documents SET current_version_id = $1, updated_at = now() WHERE id = $2', [
    versionId,
    id,
  ]);
}

async function updateDocumentMetadata({ id, title, description, documentTypeId }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE documents SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       document_type_id = COALESCE($3, document_type_id),
       updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [title ?? null, description ?? null, documentTypeId ?? null, id],
  );
  return rows[0];
}

async function updateDocumentStatus({ id, status }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE documents SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, id],
  );
  return rows[0];
}

// --- document_versions ------------------------------------------------

async function insertDocumentVersion(
  {
    documentId,
    versionNumber,
    storageKey,
    sha256Hash,
    fileName,
    mimeType,
    sizeBytes,
    encryptionVersion,
    keyId,
    changeNote = null,
    createdBy,
  },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO document_versions
       (document_id, version_number, storage_key, sha256_hash, file_name, mime_type,
        size_bytes, encryption_version, key_id, change_note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      documentId,
      versionNumber,
      storageKey,
      sha256Hash,
      fileName,
      mimeType,
      sizeBytes,
      encryptionVersion,
      keyId,
      changeNote,
      createdBy,
    ],
  );
  return rows[0];
}

async function findVersionById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM document_versions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findLatestVersionForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    'SELECT * FROM document_versions WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
    [documentId],
  );
  return rows[0] || null;
}

async function listVersionsForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT dv.*, u.username AS created_by_username
     FROM document_versions dv
     JOIN users u ON u.id = dv.created_by
     WHERE dv.document_id = $1
     ORDER BY dv.created_at DESC`,
    [documentId],
  );
  return rows;
}

async function updateVersionIntegrityStatus({ id, status }, executor = pool) {
  await executor.query('UPDATE document_versions SET integrity_status = $1 WHERE id = $2', [status, id]);
}

// Flipped by signatures.service.js once a signature actually completes
// (feature 12) — owned here, not duplicated in the signatures module,
// per the auth/users.repository.js precedent for cross-module writes to
// another module's tables.
async function markVersionSigned(id, executor = pool) {
  await executor.query('UPDATE document_versions SET is_signed = true WHERE id = $1', [id]);
}

/**
 * Duplicate-detection (feature 4): other versions anywhere in the same
 * case sharing this exact content hash, excluding the document currently
 * being uploaded to (irrelevant when re-checking your own new version).
 */
async function findVersionsByHashInCase({ caseId, hash, excludeDocumentId = null }, executor = pool) {
  const { rows } = await executor.query(
    `SELECT dv.id AS version_id, dv.version_number, dv.document_id, d.title AS document_title
     FROM document_versions dv
     JOIN documents d ON d.id = dv.document_id
     WHERE d.case_id = $1 AND dv.sha256_hash = $2
       AND ($3::uuid IS NULL OR dv.document_id != $3)`,
    [caseId, hash, excludeDocumentId],
  );
  return rows;
}

// --- document_comments -------------------------------------------------

async function insertComment({ documentId, authorId, body }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO document_comments (document_id, author_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [documentId, authorId, body],
  );
  return rows[0];
}

async function listCommentsForDocument(documentId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT dc.*, u.username AS author_username, u.full_name AS author_full_name
     FROM document_comments dc
     JOIN users u ON u.id = dc.author_id
     WHERE dc.document_id = $1
     ORDER BY dc.created_at`,
    [documentId],
  );
  return rows;
}

module.exports = {
  healthCheck,
  listDocumentTypes,
  insertDocument,
  findDocumentById,
  listDocumentsForCase,
  updateDocumentCurrentVersion,
  updateDocumentMetadata,
  updateDocumentStatus,
  insertDocumentVersion,
  findVersionById,
  findLatestVersionForDocument,
  listVersionsForDocument,
  updateVersionIntegrityStatus,
  markVersionSigned,
  findVersionsByHashInCase,
  insertComment,
  listCommentsForDocument,
};
