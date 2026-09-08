'use strict';

const repository = require('./permissions.repository');
const { withTransaction } = require('../../db/pool');
const ledger = require('../../services/ledger');
const permissionsEngine = require('../../services/permissions');
const { httpError } = require('../../errors');
const { ROLES, PERMISSIONS } = require('@secure-dms/shared');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

/**
 * Who may grant/list/revoke access grants on a resource: for any
 * resource type the permission engine already knows how to resolve an
 * owning case for (CASE itself, and — since Sprint 3 — DOCUMENT via
 * services/permissions.resolveOwningCaseId), the same SHARE right used
 * to add case members. can() internally resolves DOCUMENT's case_id and
 * checks case_membership/case_role against it, so this one check
 * correctly covers both resource types without special-casing each —
 * whoever could add a case member can also grant a document-level
 * exception on that case's documents. Resource types without an owning-
 * case resolver yet (EVIDENCE/REPORT) fall back to ADMINISTRATOR-only
 * until their modules land.
 */
async function assertGrantAuthority(actorUser, resourceType, resourceId) {
  if (resourceType === 'CASE' || resourceType === 'DOCUMENT') {
    const allowed = await permissionsEngine.can(actorUser, PERMISSIONS.SHARE, { type: resourceType, id: resourceId });
    if (!allowed) {
      throw httpError(403, 'FORBIDDEN', 'You do not have permission to manage access for this resource.');
    }
    return;
  }
  if (!actorUser.roles.includes(ROLES.ADMINISTRATOR)) {
    throw httpError(
      403,
      'FORBIDDEN',
      'Only an administrator can manage access grants for this resource type yet.',
    );
  }
}

async function grantPermission(actorUser, { resourceType, resourceId, userId, permissionCode, expiresAt }) {
  await assertGrantAuthority(actorUser, resourceType, resourceId);

  const permission = await repository.findPermissionByCode(permissionCode);
  if (!permission) throw httpError(400, 'INVALID_PERMISSION', `Unknown permission code: ${permissionCode}`);

  return withTransaction(async (client) => {
    const grant = await repository.insertGrant(
      { resourceType, resourceId, userId, permissionId: permission.id, grantedBy: actorUser.id, expiresAt },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'RESOURCE_PERMISSION_GRANTED',
      resourceType,
      resourceId,
      caseId: resourceType === 'CASE' ? resourceId : null,
      result: 'SUCCESS',
      metadata: { userId, permissionCode, expiresAt: expiresAt || null },
    });
    return grant;
  });
}

async function listGrants(actorUser, { resourceType, resourceId }) {
  await assertGrantAuthority(actorUser, resourceType, resourceId);
  return repository.listGrantsForResource({ resourceType, resourceId });
}

async function revokeGrant(actorUser, id) {
  const grant = await repository.findGrantById(id);
  if (!grant) throw httpError(404, 'NOT_FOUND', 'Grant not found.');

  await assertGrantAuthority(actorUser, grant.resource_type, grant.resource_id);

  return withTransaction(async (client) => {
    await repository.revokeGrant(id, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'RESOURCE_PERMISSION_REVOKED',
      resourceType: grant.resource_type,
      resourceId: grant.resource_id,
      caseId: grant.resource_type === 'CASE' ? grant.resource_id : null,
      result: 'SUCCESS',
      metadata: { grantId: id, userId: grant.user_id },
    });
    return { revoked: true };
  });
}

module.exports = { health, grantPermission, listGrants, revokeGrant };
