'use strict';

const { randomBytes } = require('crypto');
const repository = require('./signatures.repository');
const documentsRepository = require('../documents/documents.repository');
const { withTransaction } = require('../../db/pool');
const cryptoService = require('../../services/crypto');
const ledger = require('../../services/ledger');
const permissionsEngine = require('../../services/permissions');
const config = require('../../config');
const { httpError } = require('../../errors');

// Same master-key/keyId concept as document encryption (services/crypto,
// documents.service.js) — no separate signing-key secret this sprint.
function keyMaterial() {
  return { masterKeySecret: config.crypto.masterKey, keyId: config.documents.encryptionKeyId };
}

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

/** 24 hex chars — fits document_signatures.verification_code varchar(24) exactly. Unguessable (96 bits) but short enough to print/type. */
function generateVerificationCode() {
  return randomBytes(12).toString('hex');
}

/** Never includes private_key_envelope — that value must never leave the server in any response. */
function toPublicKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicKey: row.public_key,
    fingerprint: row.fingerprint,
    algorithm: row.algorithm,
    status: row.status,
    createdAt: row.created_at,
  };
}

// --- signing keys (feature 12) -------------------------------------------

/**
 * Generates a fresh RSA-2048 keypair for the caller and makes it their
 * ACTIVE signing key, retiring whatever was ACTIVE before (rotation —
 * old signatures made with a revoked key stay verifiable via the
 * signature row's own user_key_id, they just can't sign anything new).
 */
async function generateOrRotateKey({ actorUser }) {
  const { publicKeyPem, privateKeyPem } = cryptoService.generateRsaKeyPair();
  const fingerprint = cryptoService.hashSha256(Buffer.from(publicKeyPem, 'utf8'));
  const { envelope } = cryptoService.encrypt(Buffer.from(privateKeyPem, 'utf8'), keyMaterial());

  return withTransaction(async (client) => {
    await repository.revokeActiveUserKey(actorUser.id, client);
    const key = await repository.insertUserKey(
      {
        userId: actorUser.id,
        publicKey: publicKeyPem,
        privateKeyEnvelope: envelope,
        keyId: config.documents.encryptionKeyId,
        fingerprint,
      },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'SIGNING_KEY_GENERATED',
      resourceType: 'USER',
      resourceId: actorUser.id,
      result: 'SUCCESS',
      metadata: { fingerprint },
    });
    return toPublicKey(key);
  });
}

async function getMyKey({ actorUser }) {
  return toPublicKey(await repository.findActiveUserKey(actorUser.id));
}

// --- signing (feature 12) -------------------------------------------------

async function loadDocumentAndCurrentVersion(documentId) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  if (!document.current_version_id) {
    throw httpError(409, 'CONFLICT', 'This document has no uploaded version to sign yet.');
  }
  const version = await documentsRepository.findVersionById(document.current_version_id);
  return { document, version };
}

/**
 * Signs the document's CURRENT version's hash with the caller's own
 * ACTIVE key — you can only ever sign with your own key, never on
 * someone else's behalf. Flips document_versions.is_signed and moves
 * the document to SIGNED status (unless it's already past that point in
 * its lifecycle, e.g. ARCHIVED/DELETED).
 */
async function selfSign({ actorUser, documentId, reason }) {
  const { document, version } = await loadDocumentAndCurrentVersion(documentId);

  return withTransaction(async (client) => {
    const activeKey = await repository.findActiveUserKey(actorUser.id, client);
    if (!activeKey) {
      throw httpError(400, 'NO_SIGNING_KEY', 'Generate a signing key first (POST /signatures/keys).');
    }
    const privateKeyPem = cryptoService.decrypt(activeKey.private_key_envelope, keyMaterial()).toString('utf8');
    const signature = cryptoService.signRsa(version.sha256_hash, privateKeyPem);
    const verificationCode = generateVerificationCode();

    const row = await repository.insertSignature(
      {
        documentId,
        documentVersionId: version.id,
        signerId: actorUser.id,
        status: 'SIGNED',
        reason: reason || null,
        userKeyId: activeKey.id,
        signedHash: version.sha256_hash,
        signature,
        verificationCode,
        signedAt: new Date(),
      },
      client,
    );

    await documentsRepository.markVersionSigned(version.id, client);
    if (!['ARCHIVED', 'DELETED'].includes(document.status)) {
      await documentsRepository.updateDocumentStatus({ id: documentId, status: 'SIGNED' }, client);
    }

    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_SIGNED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { documentVersionId: version.id, signatureId: row.id, verificationCode },
    });

    return row;
  });
}

/** Asks another case member to sign the document's current version — creates the PENDING row that shows up in their queue. */
async function requestSignature({ actorUser, documentId, toUserId, reason }) {
  const { document, version } = await loadDocumentAndCurrentVersion(documentId);

  if (toUserId === actorUser.id) {
    throw httpError(400, 'INVALID_SIGNER', 'Use the direct sign endpoint to sign your own document.');
  }
  const eligible = await permissionsEngine.isCaseMember(toUserId, document.case_id);
  if (!eligible) {
    throw httpError(400, 'INELIGIBLE_SIGNER', 'The requested signer must be a member of this document’s case.');
  }

  return withTransaction(async (client) => {
    const row = await repository.insertSignature(
      {
        documentId,
        documentVersionId: version.id,
        signerId: toUserId,
        requestedBy: actorUser.id,
        status: 'PENDING',
        reason: reason || null,
      },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_SIGNATURE_REQUESTED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { toUserId, signatureId: row.id, reason: reason || null },
    });
    return row;
  });
}

async function loadPendingOrThrow(signatureId, actorUser) {
  const row = await repository.findSignatureById(signatureId);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Signature request not found.');
  if (row.status !== 'PENDING') {
    throw httpError(409, 'CONFLICT', 'This signature request is no longer pending.');
  }
  if (row.signer_id !== actorUser.id) {
    throw httpError(403, 'NOT_SIGNER', 'Only the requested signer may respond to this signature request.');
  }
  return row;
}

/**
 * Fulfils a pending signature request — the "acknowledge" side of the
 * pending-signature queue. Re-checks the request's frozen
 * document_version_id is STILL the document's current version before
 * signing (the "bound to a version hash" guarantee applied at sign
 * time, not just at request time): if the document moved on since the
 * request was made, this fails loudly instead of silently signing a
 * hash that no longer matches what the document IS.
 */
async function fulfillPending({ actorUser, signatureId }) {
  const pending = await loadPendingOrThrow(signatureId, actorUser);
  const document = await documentsRepository.findDocumentById(pending.document_id);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  if (pending.document_version_id !== document.current_version_id) {
    throw httpError(
      409,
      'STALE_REQUEST',
      'This document has changed since the signature was requested — ask the requester to send a new request.',
    );
  }
  const version = await documentsRepository.findVersionById(pending.document_version_id);

  return withTransaction(async (client) => {
    const activeKey = await repository.findActiveUserKey(actorUser.id, client);
    if (!activeKey) {
      throw httpError(400, 'NO_SIGNING_KEY', 'Generate a signing key first (POST /signatures/keys).');
    }
    const privateKeyPem = cryptoService.decrypt(activeKey.private_key_envelope, keyMaterial()).toString('utf8');
    const signature = cryptoService.signRsa(version.sha256_hash, privateKeyPem);
    const verificationCode = generateVerificationCode();

    const row = await repository.fulfillSignature(
      { id: pending.id, userKeyId: activeKey.id, signedHash: version.sha256_hash, signature, verificationCode },
      client,
    );

    await documentsRepository.markVersionSigned(version.id, client);
    if (!['ARCHIVED', 'DELETED'].includes(document.status)) {
      await documentsRepository.updateDocumentStatus({ id: document.id, status: 'SIGNED' }, client);
    }

    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_SIGNED',
      resourceType: 'DOCUMENT',
      resourceId: document.id,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: {
        documentVersionId: version.id,
        signatureId: row.id,
        verificationCode,
        requestedBy: pending.requested_by,
      },
    });

    return row;
  });
}

async function declinePending({ actorUser, signatureId, reason }) {
  const pending = await loadPendingOrThrow(signatureId, actorUser);
  const document = await documentsRepository.findDocumentById(pending.document_id);

  return withTransaction(async (client) => {
    const row = await repository.declineSignature({ id: pending.id, declineReason: reason || null }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_SIGNATURE_DECLINED',
      resourceType: 'DOCUMENT',
      resourceId: pending.document_id,
      caseId: document ? document.case_id : null,
      result: 'SUCCESS',
      metadata: { signatureId: row.id, reason: reason || null },
    });
    return row;
  });
}

async function listForDocument(documentId) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  return repository.listSignaturesForDocument(documentId);
}

async function myQueue(actorUser) {
  return repository.listPendingForSigner(actorUser.id);
}

module.exports = {
  health,
  generateOrRotateKey,
  getMyKey,
  selfSign,
  requestSignature,
  fulfillPending,
  declinePending,
  listForDocument,
  myQueue,
};
