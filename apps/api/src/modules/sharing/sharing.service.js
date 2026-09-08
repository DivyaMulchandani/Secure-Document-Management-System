'use strict';

const repository = require('./sharing.repository');
const permissionsRepository = require('../permissions/permissions.repository');
const documentsRepository = require('../documents/documents.repository');
const { withTransaction } = require('../../db/pool');
const ledger = require('../../services/ledger');
const { httpError } = require('../../errors');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Grants time-limited, read-only access to a document to ANY active
 * user — deliberately not restricted to case members, that's the whole
 * point of sharing vs. case membership. Reuses the exact same
 * resource_permissions primitive the three-layer permission engine's
 * layer 3 already enforces (services/permissions.checkResourceGrant) —
 * this module never implements its own access check, it only creates
 * the grant and keeps a document-shaped record of who/why. Auto-revoke
 * is free: once expires_at passes, checkResourceGrant simply stops
 * matching, no scheduler needed.
 */
async function createShare({ actorUser, documentId, toUserId, permission = 'VIEW', expiresInHours = 72, reason }) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  if (toUserId === actorUser.id) {
    throw httpError(400, 'INVALID_RECIPIENT', 'Cannot share a document with yourself.');
  }

  const permissionRow = await permissionsRepository.findPermissionByCode(permission);
  if (!permissionRow) throw httpError(400, 'INVALID_PERMISSION', `Unknown permission code: ${permission}`);

  const expiresAt = new Date(Date.now() + expiresInHours * HOUR_MS);

  return withTransaction(async (client) => {
    const grant = await permissionsRepository.insertGrant(
      {
        resourceType: 'DOCUMENT',
        resourceId: documentId,
        userId: toUserId,
        permissionId: permissionRow.id,
        grantedBy: actorUser.id,
        expiresAt,
      },
      client,
    );
    const share = await repository.insertShare(
      {
        documentId,
        resourcePermissionId: grant.id,
        sharedBy: actorUser.id,
        sharedWith: toUserId,
        permissionCode: permission,
        reason: reason || null,
        expiresAt,
      },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_SHARED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { toUserId, permission, expiresAt: expiresAt.toISOString(), shareId: share.id },
    });
    return { ...share, status: 'ACTIVE' };
  });
}

async function listForDocument(documentId) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  return repository.listSharesForDocument(documentId);
}

async function listMine(actorUser) {
  return repository.listSharesForRecipient(actorUser.id);
}

async function revokeShare({ actorUser, documentId, shareId }) {
  const share = await repository.findShareById(shareId);
  if (!share || share.document_id !== documentId) {
    throw httpError(404, 'NOT_FOUND', 'Share not found on this document.');
  }
  if (share.status === 'REVOKED') {
    throw httpError(409, 'CONFLICT', 'This share has already been revoked.');
  }
  const document = await documentsRepository.findDocumentById(documentId);

  return withTransaction(async (client) => {
    await permissionsRepository.revokeGrant(share.resource_permission_id, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_SHARE_REVOKED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document ? document.case_id : null,
      result: 'SUCCESS',
      metadata: { shareId, sharedWith: share.shared_with },
    });
    return { ...share, status: 'REVOKED' };
  });
}

module.exports = { health, createShare, listForDocument, listMine, revokeShare };
