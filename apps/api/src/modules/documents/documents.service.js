'use strict';

const { randomUUID } = require('crypto');
const repository = require('./documents.repository');
const { withTransaction } = require('../../db/pool');
const storage = require('../../services/storage');
const cryptoService = require('../../services/crypto');
const ledger = require('../../services/ledger');
const securityEvents = require('../../services/security-events');
const config = require('../../config');
const { httpError } = require('../../errors');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

async function listDocumentTypes() {
  return repository.listDocumentTypes();
}

function keyMaterial() {
  return { masterKeySecret: config.crypto.masterKey, keyId: config.documents.encryptionKeyId };
}

function toPublicDocument(doc) {
  return doc; // already a plain row shape; kept as a named seam for future field-shaping
}

// --- upload pipeline (docs/architecture "Feature flow · Document upload") ---

/**
 * First upload for a brand-new document: validate -> SHA-256 ->
 * AES-256-GCM encrypt -> store .enc -> version 1.0 -> audit. Permission
 * (UPLOAD on the case) is already enforced by requirePermission in
 * documents.routes.js before this ever runs; file type/size are already
 * enforced by middleware/upload.js's multer config before that.
 *
 * @param {{actorUser: object, caseId: string, documentTypeId?: string,
 *   title: string, description?: string,
 *   file: {buffer: Buffer, originalname: string, mimetype: string, size: number}}} params
 */
async function uploadNewDocument({ actorUser, caseId, documentTypeId, title, description, file }) {
  const sha256Hash = cryptoService.hashSha256(file.buffer);

  // Duplicate detection is a warning, not a block (see decision) —
  // computed up front so it can ride along in the response either way.
  const duplicates = await repository.findVersionsByHashInCase({ caseId, hash: sha256Hash });

  const { envelope, keyId } = cryptoService.encrypt(file.buffer, keyMaterial());
  const storageKey = `documents/${caseId}/${randomUUID()}.enc`;
  // Storage write happens OUTSIDE the DB transaction (the object store
  // isn't transactional with Postgres) — if the DB write below fails,
  // this leaves a harmless orphaned .enc blob that no row ever
  // references, rather than risking a committed row with no bytes
  // behind it.
  await storage.put(storageKey, envelope);

  const { document, version } = await withTransaction(async (client) => {
    const doc = await repository.insertDocument(
      { caseId, documentTypeId, title, description, ownerId: actorUser.id, status: 'ACTIVE' },
      client,
    );
    const ver = await repository.insertDocumentVersion(
      {
        documentId: doc.id,
        versionNumber: '1.0',
        storageKey,
        sha256Hash,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        encryptionVersion: '1',
        keyId,
        createdBy: actorUser.id,
      },
      client,
    );
    await repository.updateDocumentCurrentVersion({ id: doc.id, versionId: ver.id }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_UPLOAD',
      resourceType: 'DOCUMENT',
      resourceId: doc.id,
      caseId,
      result: 'SUCCESS',
      metadata: { title, fileName: file.originalname, sha256Hash, versionNumber: '1.0' },
    });
    return { document: { ...doc, current_version_id: ver.id }, version: ver };
  });

  return { ...toPublicDocument(document), currentVersion: version, duplicateOf: duplicates };
}

/**
 * A correction — inserts a NEW version row, never overwrites the old
 * one (docs/architecture "Feature flow · Version control": "no silent
 * overwrite"). Version numbers are a simple forward integer sequence
 * ("1.0" -> "2.0" -> "3.0"); the architecture's own example shows a
 * major.minor scheme (1.0 -> 1.1 -> 2.0) but doesn't specify what makes
 * a change "minor" vs "major", so this sprint keeps it simple and
 * unambiguous.
 */
async function uploadNewVersion({ actorUser, documentId, file, changeNote }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  if (document.status === 'DELETED') {
    throw httpError(409, 'CONFLICT', 'Cannot add a version to a deleted document.');
  }

  const sha256Hash = cryptoService.hashSha256(file.buffer);
  const duplicates = await repository.findVersionsByHashInCase({
    caseId: document.case_id,
    hash: sha256Hash,
    excludeDocumentId: documentId,
  });

  const { envelope, keyId } = cryptoService.encrypt(file.buffer, keyMaterial());
  const storageKey = `documents/${document.case_id}/${randomUUID()}.enc`;
  await storage.put(storageKey, envelope);

  const latest = await repository.findLatestVersionForDocument(documentId);
  const nextVersionNumber = `${Math.floor(parseFloat(latest.version_number)) + 1}.0`;

  const version = await withTransaction(async (client) => {
    const ver = await repository.insertDocumentVersion(
      {
        documentId,
        versionNumber: nextVersionNumber,
        storageKey,
        sha256Hash,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        encryptionVersion: '1',
        keyId,
        changeNote,
        createdBy: actorUser.id,
      },
      client,
    );
    await repository.updateDocumentCurrentVersion({ id: documentId, versionId: ver.id }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'VERSION_CREATED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { versionNumber: nextVersionNumber, fileName: file.originalname, sha256Hash, changeNote: changeNote || null },
    });
    return ver;
  });

  return { ...version, duplicateOf: duplicates };
}

/**
 * "Authorized version restoration" (feature 7): creates a NEW forward
 * version whose content is byte-for-byte the old version's (same
 * storage_key/hash — the old ciphertext object is reused as-is, no need
 * to re-encrypt or re-upload), rather than rewinding current_version_id.
 * The whole timeline — including the fact that a restoration happened
 * and from where — stays in the immutable, forward-only version history.
 */
async function restoreVersion({ actorUser, documentId, versionId }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  const target = await repository.findVersionById(versionId);
  if (!target || target.document_id !== documentId) {
    throw httpError(404, 'NOT_FOUND', 'Version not found on this document.');
  }

  const latest = await repository.findLatestVersionForDocument(documentId);
  const nextVersionNumber = `${Math.floor(parseFloat(latest.version_number)) + 1}.0`;

  const version = await withTransaction(async (client) => {
    const ver = await repository.insertDocumentVersion(
      {
        documentId,
        versionNumber: nextVersionNumber,
        storageKey: target.storage_key,
        sha256Hash: target.sha256_hash,
        fileName: target.file_name,
        mimeType: target.mime_type,
        sizeBytes: target.size_bytes,
        encryptionVersion: target.encryption_version,
        keyId: target.key_id,
        changeNote: `Restored from version ${target.version_number}`,
        createdBy: actorUser.id,
      },
      client,
    );
    await repository.updateDocumentCurrentVersion({ id: documentId, versionId: ver.id }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'VERSION_RESTORED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { restoredFromVersionId: versionId, restoredFromVersionNumber: target.version_number, newVersionNumber: nextVersionNumber },
    });
    return ver;
  });

  return version;
}

// --- access / download (docs/architecture "Feature flow · Authorized access & download") ---

async function getDocument({ documentId }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  return document;
}

async function listDocuments(filters) {
  return repository.listDocumentsForCase(filters);
}

async function listVersions({ documentId }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  return repository.listVersionsForDocument(documentId);
}

/**
 * Every read re-verifies integrity: decrypt, re-hash, compare against
 * the hash captured at upload. A mismatch doesn't just fail the
 * download — it flips integrity_status to MODIFIED and raises a real
 * security_events(INTEGRITY_FAILURE) row, matching the architecture
 * exactly. `versionId` omitted = the document's current version.
 */
async function downloadVersion({ actorUser, documentId, versionId, ipAddress }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  const version = await repository.findVersionById(versionId || document.current_version_id);
  if (!version || version.document_id !== documentId) {
    throw httpError(404, 'NOT_FOUND', 'Version not found on this document.');
  }

  const cipher = await storage.get(version.storage_key);
  const plaintext = cryptoService.decrypt(cipher, keyMaterial());
  const currentHash = cryptoService.hashSha256(plaintext);

  if (currentHash === version.sha256_hash) {
    await withTransaction(async (client) => {
      await repository.updateVersionIntegrityStatus({ id: version.id, status: 'VERIFIED' }, client);
      await ledger.appendEvent(client, {
        actorUserId: actorUser.id,
        action: 'DOCUMENT_ACCESS',
        resourceType: 'DOCUMENT',
        resourceId: documentId,
        caseId: document.case_id,
        result: 'SUCCESS',
        ipAddress,
        metadata: { versionId: version.id, versionNumber: version.version_number },
      });
    });
    return { buffer: plaintext, fileName: version.file_name, mimeType: version.mime_type, integrityStatus: 'VERIFIED' };
  }

  await withTransaction(async (client) => {
    await repository.updateVersionIntegrityStatus({ id: version.id, status: 'MODIFIED' }, client);
    await securityEvents.raise(client, {
      eventType: 'INTEGRITY_FAILURE',
      severity: 'CRITICAL',
      userId: actorUser.id,
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      description: `SHA-256 mismatch on version ${version.version_number}: expected ${version.sha256_hash}, got ${currentHash}.`,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_ACCESS',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'FAILURE',
      ipAddress,
      metadata: { versionId: version.id, versionNumber: version.version_number, reason: 'INTEGRITY_FAILURE' },
    });
  });
  throw httpError(
    409,
    'INTEGRITY_FAILURE',
    'Document integrity check failed — the stored content does not match its recorded hash.',
  );
}

// --- metadata / lifecycle ---------------------------------------------

async function updateDocument({ actorUser, documentId, title, description, documentTypeId }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  return withTransaction(async (client) => {
    const updated = await repository.updateDocumentMetadata({ id: documentId, title, description, documentTypeId }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_UPDATED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { title, description, documentTypeId },
    });
    return updated;
  });
}

/** Soft delete only — status=DELETED. Bytes/versions are never purged. */
async function deleteDocument({ actorUser, documentId }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  return withTransaction(async (client) => {
    const updated = await repository.updateDocumentStatus({ id: documentId, status: 'DELETED' }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_DELETED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

// --- comments ---------------------------------------------------------

async function addComment({ actorUser, documentId, body }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  return withTransaction(async (client) => {
    const comment = await repository.insertComment({ documentId, authorId: actorUser.id, body }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_COMMENTED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
    });
    return comment;
  });
}

async function listComments({ documentId }) {
  const document = await repository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  return repository.listCommentsForDocument(documentId);
}

module.exports = {
  health,
  listDocumentTypes,
  uploadNewDocument,
  uploadNewVersion,
  restoreVersion,
  getDocument,
  listDocuments,
  listVersions,
  downloadVersion,
  updateDocument,
  deleteDocument,
  addComment,
  listComments,
};
