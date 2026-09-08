'use strict';

const repository = require('./verification.repository');
const documentsRepository = require('../documents/documents.repository');
const signaturesRepository = require('../signatures/signatures.repository');
const auditService = require('../audit/audit.service');
const storage = require('../../services/storage');
const cryptoService = require('../../services/crypto');
const config = require('../../config');
const { httpError } = require('../../errors');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

function keyMaterial() {
  return { masterKeySecret: config.crypto.masterKey, keyId: config.documents.encryptionKeyId };
}

/**
 * The four checks (docs/architecture "Feature flow · Document
 * verification portal"):
 *
 *  - hash_check: re-decrypt the STORED bytes and re-hash them, compared
 *    against `signed_hash` — the hash frozen on the signature row at
 *    signing time (the ground truth "bound to a version hash" value,
 *    not whatever document_versions.sha256_hash reads right now).
 *  - signature_check: cryptographically verify the RSA-SHA256 signature
 *    against the signer's public key and that same signed_hash —
 *    independent of hash_check, this catches a forged/corrupted
 *    signature blob even if the content itself is untouched.
 *  - ledger_check: recompute the ENTIRE global audit hash chain
 *    (services/ledger, via audit.service.verifyChain) — proof the audit
 *    trail itself hasn't been tampered with anywhere, not just around
 *    this one document. Deliberately global, not document-scoped:
 *    tampering with row N breaks every hash after it regardless of
 *    which resource row N was about.
 *  - version_check: is the signed version still the document's CURRENT
 *    version? A genuinely valid, untampered signature on a version the
 *    document has since moved past is neither authentic (doesn't match
 *    what the document is today) nor tampered (nothing was forged) —
 *    that's what makes SUPERSEDED a real third outcome, not just
 *    AUTHENTIC/TAMPERED.
 */
async function runFourChecks(signature) {
  const version = await documentsRepository.findVersionById(signature.document_version_id);
  const document = await documentsRepository.findDocumentById(signature.document_id);
  const userKey = await signaturesRepository.findUserKeyById(signature.user_key_id);

  let hashCheck = false;
  try {
    const cipher = await storage.get(version.storage_key);
    const plaintext = cryptoService.decrypt(cipher, keyMaterial());
    const actualHash = cryptoService.hashSha256(plaintext);
    hashCheck = actualHash === signature.signed_hash;
  } catch {
    hashCheck = false; // a missing/corrupt/undecryptable stored object also fails the check, never throws
  }

  const signatureCheck = userKey
    ? cryptoService.verifyRsa(signature.signed_hash, signature.signature, userKey.public_key)
    : false;

  const ledgerResult = await auditService.verifyChain();
  const ledgerCheck = ledgerResult.intact;

  const versionCheck = document.current_version_id === signature.document_version_id;

  let overallResult;
  if (!hashCheck || !signatureCheck || !ledgerCheck) {
    overallResult = 'TAMPERED';
  } else if (!versionCheck) {
    overallResult = 'SUPERSEDED';
  } else {
    overallResult = 'AUTHENTIC';
  }

  return {
    document,
    version,
    signature,
    userKey,
    checks: { hashCheck, signatureCheck, ledgerCheck, versionCheck },
    overallResult,
  };
}

/**
 * Deliberately minimal — the response never carries file content, and
 * the public/external path additionally strips case/investigation
 * identifiers, showing only what's needed to establish "this document
 * was authentically signed and hasn't been altered" (the whole point of
 * a signature IS that the signer's identity is verifiable, so the
 * signer's username is shown even publicly — that's not a leak, that's
 * the certificate).
 */
function toPortalResponse(result, record, { publicOnly = false } = {}) {
  const base = {
    status: result.overallResult, // AUTHENTIC | TAMPERED | SUPERSEDED
    checks: result.checks,
    documentTitle: result.document.title,
    versionNumber: result.version.version_number,
    signerUsername: result.signature.signer_username,
    signedAt: result.signature.signed_at,
    signerKeyFingerprint: result.userKey ? result.userKey.fingerprint : null,
    verifiedAt: record.created_at,
  };
  if (publicOnly) return base;
  return {
    ...base,
    documentId: result.document.id,
    caseId: result.document.case_id,
    signerId: result.signature.signer_id,
    verificationCode: result.signature.verification_code,
  };
}

async function verifyDocumentInternal({ actorUser, documentId, ipAddress }) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');

  const signature = await signaturesRepository.findLatestSignedForDocument(documentId);
  if (!signature) {
    return { status: 'UNSIGNED', documentTitle: document.title };
  }

  const result = await runFourChecks(signature);
  const record = await repository.insertRecord({
    documentId,
    documentSignatureId: signature.id,
    verifiedBy: actorUser.id,
    hashCheck: result.checks.hashCheck,
    signatureCheck: result.checks.signatureCheck,
    ledgerCheck: result.checks.ledgerCheck,
    versionCheck: result.checks.versionCheck,
    overallResult: result.overallResult,
    source: 'INTERNAL',
    ipAddress,
  });

  return toPortalResponse(result, record);
}

/** The external-verifier path — no login, looked up purely by the shareable verification_code printed/attached to the signed document. */
async function verifyByCode({ code, ipAddress }) {
  const signature = await signaturesRepository.findSignatureByVerificationCode(code);
  if (!signature || signature.status !== 'SIGNED') {
    return { status: 'NOT_FOUND' };
  }
  const result = await runFourChecks(signature);
  const record = await repository.insertRecord({
    documentId: signature.document_id,
    documentSignatureId: signature.id,
    verifiedBy: null,
    hashCheck: result.checks.hashCheck,
    signatureCheck: result.checks.signatureCheck,
    ledgerCheck: result.checks.ledgerCheck,
    versionCheck: result.checks.versionCheck,
    overallResult: result.overallResult,
    source: 'EXTERNAL',
    ipAddress,
  });
  return toPortalResponse(result, record, { publicOnly: true });
}

async function listRecordsForDocument(documentId) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  return repository.listForDocument(documentId);
}

module.exports = { health, verifyDocumentInternal, verifyByCode, listRecordsForDocument };
