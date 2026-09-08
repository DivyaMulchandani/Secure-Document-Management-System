'use strict';

const { randomUUID } = require('crypto');
const repository = require('./evidence.repository');
const { pool, withTransaction } = require('../../db/pool');
const storage = require('../../services/storage');
const cryptoService = require('../../services/crypto');
const ledger = require('../../services/ledger');
const custodyLedger = require('../../services/custody-ledger');
const securityEvents = require('../../services/security-events');
const permissionsEngine = require('../../services/permissions');
const config = require('../../config');
const { httpError } = require('../../errors');

function keyMaterial() {
  return { masterKeySecret: config.crypto.masterKey, keyId: config.documents.encryptionKeyId };
}

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

function assertIsCurrentCustodian(evidenceRow, actorUser) {
  if (evidenceRow.current_custodian_id !== actorUser.id) {
    throw httpError(
      403,
      'NOT_CUSTODIAN',
      'Only the current custodian may perform this action on this evidence item.',
    );
  }
}

/**
 * Legal evidence-status transitions (docs/architecture — "Lifecycle
 * state machines · EVIDENCE"), enforced exactly.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  REGISTERED: ['SEALED'],
  SEALED: ['IN_CUSTODY'], // verifyEvidence() passes through VERIFIED in the same call — see its doc comment
  VERIFIED: ['IN_CUSTODY'],
  IN_CUSTODY: ['IN_TRANSIT', 'RETURNED'],
  IN_TRANSIT: ['RECEIVED', 'IN_CUSTODY'], // IN_CUSTODY = reverts here on reject
  RECEIVED: ['UNDER_ANALYSIS'],
  UNDER_ANALYSIS: ['IN_CUSTODY'],
  RETURNED: ['ARCHIVED'],
  ARCHIVED: [],
});

function assertLegalTransition(fromStatus, toStatus) {
  if (!(ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus)) {
    throw httpError(409, 'ILLEGAL_TRANSITION', `Cannot move evidence from ${fromStatus} to ${toStatus}.`);
  }
}

// --- register (docs/architecture "Feature flow · Evidence registration & chain of custody") ---

/**
 * @param {{actorUser: object, caseId: string, title: string, description?: string,
 *   category?: string, location?: string,
 *   file: {buffer: Buffer, originalname: string, mimetype: string, size: number}}} params
 */
async function registerEvidence({ actorUser, caseId, title, description, category, location, file }) {
  const sha256Hash = cryptoService.hashSha256(file.buffer);
  // evidence_artifacts has no key_id/encryption_version columns (unlike
  // document_versions) — architecture's leaner field list for this
  // table, consistent with the single-master-key decision this sprint.
  const { envelope } = cryptoService.encrypt(file.buffer, keyMaterial());
  const storageKey = `evidence/${caseId}/${randomUUID()}.enc`;
  // Storage write outside the DB transaction — same rationale as
  // documents.service.js (object store isn't transactional with Postgres).
  await storage.put(storageKey, envelope);

  return withTransaction(async (client) => {
    const evidenceNumber = await repository.nextEvidenceNumber(caseId, client);
    const evidenceRow = await repository.insertEvidence(
      {
        caseId,
        evidenceNumber,
        title,
        description,
        category,
        custodianId: actorUser.id,
        location,
        createdBy: actorUser.id,
      },
      client,
    );
    const artifact = await repository.insertArtifact(
      {
        evidenceId: evidenceRow.id,
        storageKey,
        sha256Hash,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
      client,
    );
    await custodyLedger.appendEvent(client, {
      evidenceId: evidenceRow.id,
      toUserId: actorUser.id,
      action: 'REGISTER',
      status: 'COMPLETED',
      integrityVerified: true,
      toLocation: location || null,
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_REGISTERED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceRow.id,
      caseId,
      result: 'SUCCESS',
      metadata: { evidenceNumber, title, sha256Hash },
    });
    return { ...evidenceRow, artifacts: [artifact] };
  });
}

/** Adds an additional artifact to an already-registered evidence item — e.g. a second photo. */
async function addArtifact({ actorUser, evidenceId, file }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertIsCurrentCustodian(evidenceRow, actorUser);

  const sha256Hash = cryptoService.hashSha256(file.buffer);
  const { envelope } = cryptoService.encrypt(file.buffer, keyMaterial());
  const storageKey = `evidence/${evidenceRow.case_id}/${randomUUID()}.enc`;
  await storage.put(storageKey, envelope);

  return withTransaction(async (client) => {
    const artifact = await repository.insertArtifact(
      { evidenceId, storageKey, sha256Hash, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_ARTIFACT_ADDED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
      metadata: { fileName: file.originalname, sha256Hash },
    });
    return artifact;
  });
}

// --- seal / verify -------------------------------------------------------

async function sealEvidence({ actorUser, evidenceId }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertIsCurrentCustodian(evidenceRow, actorUser);
  assertLegalTransition(evidenceRow.status, 'SEALED');

  return withTransaction(async (client) => {
    const updated = await repository.updateEvidenceState({ id: evidenceId, status: 'SEALED' }, client);
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: actorUser.id,
      toUserId: actorUser.id,
      action: 'SEAL',
      status: 'COMPLETED',
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_SEALED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

/**
 * Re-hashes every artifact attached to this evidence item. On a clean
 * SEALED item where every artifact still matches, this is also what
 * carries the item through VERIFIED into IN_CUSTODY in one call (the
 * architecture's state machine has no distinct user action between
 * "verified" and "in custody" — being verified and unclaimed-in-transit
 * IS being in custody). Re-verifying an item that's already past SEALED
 * (e.g. already IN_CUSTODY) just re-checks integrity without moving the
 * status — the same "every read re-verifies" principle as document
 * downloads. No custody_events row: this is an integrity check, not a
 * hand-off.
 */
async function verifyEvidence({ actorUser, evidenceId }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');

  const artifacts = await repository.listArtifactsForEvidence(evidenceId);
  if (artifacts.length === 0) throw httpError(409, 'CONFLICT', 'This evidence item has no artifacts to verify.');

  const results = [];
  let allMatch = true;
  for (const artifact of artifacts) {
    // eslint-disable-next-line no-await-in-loop
    const cipher = await storage.get(artifact.storage_key);
    const plaintext = cryptoService.decrypt(cipher, keyMaterial());
    const currentHash = cryptoService.hashSha256(plaintext);
    const matches = currentHash === artifact.sha256_hash;
    if (!matches) allMatch = false;
    results.push({ artifactId: artifact.id, fileName: artifact.file_name, matches });
  }

  const willAdvance = allMatch && evidenceRow.status === 'SEALED';

  await withTransaction(async (client) => {
    await Promise.all(
      results.map((r) =>
        repository.updateArtifactIntegrityStatus({ id: r.artifactId, status: r.matches ? 'VERIFIED' : 'MODIFIED' }, client),
      ),
    );

    if (willAdvance) {
      await repository.updateEvidenceState({ id: evidenceId, status: 'IN_CUSTODY' }, client);
    }

    if (allMatch) {
      await ledger.appendEvent(client, {
        actorUserId: actorUser.id,
        action: 'EVIDENCE_VERIFIED',
        resourceType: 'EVIDENCE',
        resourceId: evidenceId,
        caseId: evidenceRow.case_id,
        result: 'SUCCESS',
        metadata: { artifactCount: artifacts.length, advancedToInCustody: willAdvance },
      });
    } else {
      const failed = results.filter((r) => !r.matches);
      await securityEvents.raise(client, {
        eventType: 'INTEGRITY_FAILURE',
        severity: 'CRITICAL',
        userId: actorUser.id,
        resourceType: 'EVIDENCE',
        resourceId: evidenceId,
        description: `SHA-256 mismatch on ${failed.length} of ${artifacts.length} artifact(s) for evidence ${evidenceRow.evidence_number}.`,
      });
      await ledger.appendEvent(client, {
        actorUserId: actorUser.id,
        action: 'EVIDENCE_VERIFIED',
        resourceType: 'EVIDENCE',
        resourceId: evidenceId,
        caseId: evidenceRow.case_id,
        result: 'FAILURE',
        metadata: { artifactResults: results },
      });
    }
  });

  return { allMatch, advancedToInCustody: willAdvance, artifacts: results };
}

// --- read ---------------------------------------------------------------

async function getEvidence(evidenceId) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  const artifacts = await repository.listArtifactsForEvidence(evidenceId);
  return { ...evidenceRow, artifacts };
}

async function listEvidence(filters) {
  return repository.listEvidenceForCase(filters);
}

async function listArtifacts(evidenceId) {
  return repository.listArtifactsForEvidence(evidenceId);
}

/** Every read re-verifies integrity — same principle as document downloads. */
async function downloadArtifact({ actorUser, evidenceId, artifactId, ipAddress }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  const artifact = await repository.findArtifactById(artifactId);
  if (!artifact || artifact.evidence_id !== evidenceId) {
    throw httpError(404, 'NOT_FOUND', 'Artifact not found on this evidence item.');
  }

  const cipher = await storage.get(artifact.storage_key);
  const plaintext = cryptoService.decrypt(cipher, keyMaterial());
  const currentHash = cryptoService.hashSha256(plaintext);

  if (currentHash === artifact.sha256_hash) {
    await withTransaction(async (client) => {
      await repository.updateArtifactIntegrityStatus({ id: artifact.id, status: 'VERIFIED' }, client);
      await ledger.appendEvent(client, {
        actorUserId: actorUser.id,
        action: 'EVIDENCE_ACCESS',
        resourceType: 'EVIDENCE',
        resourceId: evidenceId,
        caseId: evidenceRow.case_id,
        result: 'SUCCESS',
        ipAddress,
        metadata: { artifactId },
      });
    });
    return { buffer: plaintext, fileName: artifact.file_name, mimeType: artifact.mime_type };
  }

  await withTransaction(async (client) => {
    await repository.updateArtifactIntegrityStatus({ id: artifact.id, status: 'MODIFIED' }, client);
    await securityEvents.raise(client, {
      eventType: 'INTEGRITY_FAILURE',
      severity: 'CRITICAL',
      userId: actorUser.id,
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      description: `SHA-256 mismatch on artifact ${artifactId}: expected ${artifact.sha256_hash}, got ${currentHash}.`,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_ACCESS',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'FAILURE',
      ipAddress,
      metadata: { artifactId, reason: 'INTEGRITY_FAILURE' },
    });
  });
  throw httpError(409, 'INTEGRITY_FAILURE', 'Evidence integrity check failed — download blocked.');
}

// --- transfer (docs/architecture "Feature flow · Evidence registration & chain of custody") ---

async function requestTransfer({ actorUser, evidenceId, toUserId, reason, toLocation }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertIsCurrentCustodian(evidenceRow, actorUser);
  assertLegalTransition(evidenceRow.status, 'IN_TRANSIT');

  if (toUserId === actorUser.id) {
    throw httpError(400, 'INVALID_RECIPIENT', 'Cannot transfer evidence to yourself.');
  }
  const eligible = await permissionsEngine.isCaseMember(toUserId, evidenceRow.case_id);
  if (!eligible) {
    throw httpError(400, 'INELIGIBLE_CUSTODIAN', 'The recipient must be a member of this evidence’s case.');
  }

  return withTransaction(async (client) => {
    await repository.updateEvidenceState({ id: evidenceId, status: 'IN_TRANSIT' }, client);
    const custodyEvent = await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: actorUser.id,
      toUserId,
      action: 'TRANSFER_REQUEST',
      status: 'PENDING',
      reason: reason || null,
      fromLocation: evidenceRow.current_location,
      toLocation: toLocation || null,
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_TRANSFER_REQUESTED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
      metadata: { toUserId, reason: reason || null, custodyEventId: custodyEvent.id },
    });
    return { transferId: custodyEvent.id };
  });
}

/**
 * The receiving side of a transfer — this IS the "acknowledge" step
 * (docs/architecture: "R->>E: acknowledge receipt" triggers hash
 * re-verification in the same beat, there is no separate unverified
 * acknowledgement step). Only the pending transfer's to_user_id may
 * call this — a resource-instance-specific check the generic
 * three-layer engine can't express, done here instead.
 */
async function acceptTransfer({ actorUser, evidenceId, transferId }) {
  const { evidenceRow, transfer } = await loadPendingTransferOrThrow(evidenceId, transferId, actorUser);

  const artifacts = await repository.listArtifactsForEvidence(evidenceId);
  const results = [];
  let allMatch = true;
  for (const artifact of artifacts) {
    // eslint-disable-next-line no-await-in-loop
    const cipher = await storage.get(artifact.storage_key);
    const plaintext = cryptoService.decrypt(cipher, keyMaterial());
    const currentHash = cryptoService.hashSha256(plaintext);
    const matches = currentHash === artifact.sha256_hash;
    if (!matches) allMatch = false;
    results.push({ artifactId: artifact.id, matches });
  }

  if (allMatch) {
    return withTransaction(async (client) => {
      await Promise.all(
        results.map((r) => repository.updateArtifactIntegrityStatus({ id: r.artifactId, status: 'VERIFIED' }, client)),
      );
      await repository.updateEvidenceState(
        { id: evidenceId, status: 'RECEIVED', custodianId: actorUser.id, location: transfer.to_location },
        client,
      );
      await custodyLedger.appendEvent(client, {
        evidenceId,
        fromUserId: transfer.from_user_id,
        toUserId: actorUser.id,
        action: 'RECEIVE',
        status: 'COMPLETED',
        integrityVerified: true,
        fromLocation: transfer.from_location,
        toLocation: transfer.to_location,
        createdBy: actorUser.id,
      });
      await ledger.appendEvent(client, {
        actorUserId: actorUser.id,
        action: 'EVIDENCE_TRANSFER',
        resourceType: 'EVIDENCE',
        resourceId: evidenceId,
        caseId: evidenceRow.case_id,
        result: 'SUCCESS',
        metadata: { transferId, fromUserId: transfer.from_user_id },
      });
      return repository.findEvidenceById(evidenceId, client);
    });
  }

  await withTransaction(async (client) => {
    await Promise.all(
      results.map((r) => repository.updateArtifactIntegrityStatus({ id: r.artifactId, status: r.matches ? 'VERIFIED' : 'MODIFIED' }, client)),
    );
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: transfer.from_user_id,
      toUserId: actorUser.id,
      action: 'RECEIVE',
      status: 'REJECTED',
      integrityVerified: false,
      reason: 'Integrity check failed on receipt.',
      fromLocation: transfer.from_location,
      toLocation: transfer.to_location,
      createdBy: actorUser.id,
    });
    await securityEvents.raise(client, {
      eventType: 'CUSTODY_VIOLATION',
      severity: 'CRITICAL',
      userId: actorUser.id,
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      description: `Chain-of-custody integrity check failed on transfer ${transferId} for evidence ${evidenceRow.evidence_number}.`,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_TRANSFER',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'FAILURE',
      metadata: { transferId, reason: 'CUSTODY_VIOLATION' },
    });
    // Evidence stays IN_TRANSIT — an integrity failure mid-transfer
    // needs manual/administrative resolution, out of scope this sprint.
  });
  throw httpError(409, 'CUSTODY_VIOLATION', 'Integrity check failed on receipt — transfer blocked.');
}

async function rejectTransfer({ actorUser, evidenceId, transferId, reason }) {
  const { evidenceRow, transfer } = await loadPendingTransferOrThrow(evidenceId, transferId, actorUser);

  return withTransaction(async (client) => {
    await repository.updateEvidenceState(
      { id: evidenceId, status: 'IN_CUSTODY', custodianId: transfer.from_user_id, location: transfer.from_location },
      client,
    );
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: transfer.from_user_id,
      toUserId: actorUser.id,
      action: 'RECEIVE',
      status: 'REJECTED',
      reason: reason || 'Declined by recipient.',
      fromLocation: transfer.from_location,
      toLocation: transfer.to_location,
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_TRANSFER_REJECTED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
      metadata: { transferId, reason: reason || null },
    });
    return repository.findEvidenceById(evidenceId, client);
  });
}

async function loadPendingTransferOrThrow(evidenceId, transferId, actorUser) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');

  const transfer = await repository.findLatestPendingTransfer(evidenceId);
  if (!transfer || transfer.id !== transferId) {
    throw httpError(404, 'NOT_FOUND', 'No matching pending transfer found for this evidence item.');
  }
  if (transfer.to_user_id !== actorUser.id) {
    throw httpError(403, 'NOT_RECIPIENT', 'Only the intended recipient may respond to this transfer.');
  }
  return { evidenceRow, transfer };
}

// --- analysis / return / archive -----------------------------------------

async function startAnalysis({ actorUser, evidenceId }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertIsCurrentCustodian(evidenceRow, actorUser);
  assertLegalTransition(evidenceRow.status, 'UNDER_ANALYSIS');

  return withTransaction(async (client) => {
    const updated = await repository.updateEvidenceState({ id: evidenceId, status: 'UNDER_ANALYSIS' }, client);
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: actorUser.id,
      toUserId: actorUser.id,
      action: 'ANALYZE',
      status: 'PENDING',
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_ANALYSIS_STARTED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

async function completeAnalysis({ actorUser, evidenceId }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertIsCurrentCustodian(evidenceRow, actorUser);
  assertLegalTransition(evidenceRow.status, 'IN_CUSTODY');

  return withTransaction(async (client) => {
    const updated = await repository.updateEvidenceState({ id: evidenceId, status: 'IN_CUSTODY' }, client);
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: actorUser.id,
      toUserId: actorUser.id,
      action: 'ANALYZE',
      status: 'COMPLETED',
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_ANALYSIS_COMPLETED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

async function returnEvidence({ actorUser, evidenceId }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertIsCurrentCustodian(evidenceRow, actorUser);
  assertLegalTransition(evidenceRow.status, 'RETURNED');

  return withTransaction(async (client) => {
    const updated = await repository.updateEvidenceState({ id: evidenceId, status: 'RETURNED' }, client);
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: actorUser.id,
      toUserId: actorUser.id,
      action: 'RETURN',
      status: 'COMPLETED',
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_RETURNED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

/**
 * Unlike seal/transfer/analyze/return, archiving does NOT require the
 * actor to be the current physical custodian — it's a case-closure
 * action (typically done by the case owner/investigator), not a
 * custody hand-off, and PERMISSIONS.ARCHIVE is deliberately not granted
 * to the FORENSIC case_role (matrix has no forensic-archives-evidence
 * capability) — requiring custodianship here would strand evidence
 * whose last holder was a forensic officer with no way to archive it.
 */
async function archiveEvidence({ actorUser, evidenceId }) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  assertLegalTransition(evidenceRow.status, 'ARCHIVED');

  return withTransaction(async (client) => {
    const updated = await repository.updateEvidenceState({ id: evidenceId, status: 'ARCHIVED' }, client);
    await custodyLedger.appendEvent(client, {
      evidenceId,
      fromUserId: actorUser.id,
      toUserId: actorUser.id,
      action: 'ARCHIVE',
      status: 'COMPLETED',
      createdBy: actorUser.id,
    });
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'EVIDENCE_ARCHIVED',
      resourceType: 'EVIDENCE',
      resourceId: evidenceId,
      caseId: evidenceRow.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

// --- custody timeline / verification --------------------------------------

async function getCustodyTimeline(evidenceId) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  return repository.listCustodyEvents(evidenceId);
}

async function verifyCustodyChain(evidenceId) {
  const evidenceRow = await repository.findEvidenceById(evidenceId);
  if (!evidenceRow) throw httpError(404, 'NOT_FOUND', 'Evidence not found.');
  return custodyLedger.verifyChain(pool, evidenceId);
}

module.exports = {
  health,
  registerEvidence,
  addArtifact,
  sealEvidence,
  verifyEvidence,
  getEvidence,
  listEvidence,
  listArtifacts,
  downloadArtifact,
  requestTransfer,
  acceptTransfer,
  rejectTransfer,
  startAnalysis,
  completeAnalysis,
  returnEvidence,
  archiveEvidence,
  getCustodyTimeline,
  verifyCustodyChain,
};
