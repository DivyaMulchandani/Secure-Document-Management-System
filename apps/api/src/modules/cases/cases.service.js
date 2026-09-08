'use strict';

const repository = require('./cases.repository');
const { withTransaction } = require('../../db/pool');
const ledger = require('../../services/ledger');
const { httpError } = require('../../errors');
const { ROLES, CASE_ROLES, CASE_STATUSES } = require('@secure-dms/shared');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

/**
 * Legal case-status transitions (docs/architecture — "Lifecycle state
 * machines · CASE"). CLOSED -> UNDER_INVESTIGATION is the "reopen
 * (authorized)" transition — gated to ADMINISTRATOR only, below.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [CASE_STATUSES.OPEN]: [CASE_STATUSES.UNDER_INVESTIGATION],
  [CASE_STATUSES.UNDER_INVESTIGATION]: [CASE_STATUSES.UNDER_REVIEW],
  [CASE_STATUSES.UNDER_REVIEW]: [CASE_STATUSES.SUBMITTED],
  [CASE_STATUSES.SUBMITTED]: [CASE_STATUSES.CLOSED],
  [CASE_STATUSES.CLOSED]: [CASE_STATUSES.ARCHIVED, CASE_STATUSES.UNDER_INVESTIGATION],
  [CASE_STATUSES.ARCHIVED]: [],
});

// --- cases ---------------------------------------------------------------

async function createCase({ creatorUserId, title, description, priority, departmentId }) {
  return withTransaction(async (client) => {
    const caseNumber = await repository.nextCaseNumber(client);
    const newCase = await repository.insertCase(
      { caseNumber, title, description, priority: priority || 'MEDIUM', ownerId: creatorUserId, departmentId },
      client,
    );
    await repository.insertCaseMember(
      { caseId: newCase.id, userId: creatorUserId, caseRole: CASE_ROLES.OWNER, addedBy: creatorUserId },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: creatorUserId,
      action: 'CASE_CREATED',
      resourceType: 'CASE',
      resourceId: newCase.id,
      caseId: newCase.id,
      result: 'SUCCESS',
      metadata: { caseNumber, title },
    });
    return newCase;
  });
}

async function getCase(id) {
  const caseRow = await repository.findCaseById(id);
  if (!caseRow) throw httpError(404, 'NOT_FOUND', 'Case not found.');
  return caseRow;
}

/**
 * ADMINISTRATOR/AUDITOR see every case (matches the Role Capability
 * Matrix's "Read full audit ledger" / oversight posture — extended
 * here to case visibility for the same two oversight roles). Everyone
 * else sees only cases they're an active case_member of; this is a
 * LISTING-level convenience, not a bypass of per-case access — opening
 * a specific case's full detail/content still goes through
 * services/permissions.can() same as everyone (see the "Admin case
 * bypass" decision).
 */
async function listCases(requestingUser, filters) {
  const isPrivileged =
    requestingUser.roles.includes(ROLES.ADMINISTRATOR) || requestingUser.roles.includes(ROLES.AUDITOR);
  return repository.listCases({ userId: requestingUser.id, isPrivileged, ...filters });
}

async function updateCase({ actorUserId, id, title, description, priority, departmentId }) {
  const existing = await repository.findCaseById(id);
  if (!existing) throw httpError(404, 'NOT_FOUND', 'Case not found.');

  return withTransaction(async (client) => {
    const updated = await repository.updateCase({ id, title, description, priority, departmentId }, client);
    await ledger.appendEvent(client, {
      actorUserId,
      action: 'CASE_UPDATED',
      resourceType: 'CASE',
      resourceId: id,
      caseId: id,
      result: 'SUCCESS',
      metadata: { title, description, priority, departmentId },
    });
    return updated;
  });
}

async function updateCaseStatus({ actorUserId, actorRoles, id, status }) {
  const existing = await repository.findCaseById(id);
  if (!existing) throw httpError(404, 'NOT_FOUND', 'Case not found.');

  const legalNextStatuses = ALLOWED_TRANSITIONS[existing.status] || [];
  if (!legalNextStatuses.includes(status)) {
    throw httpError(
      409,
      'ILLEGAL_TRANSITION',
      `Cannot move a case from ${existing.status} to ${status}.`,
    );
  }

  const isReopen = existing.status === CASE_STATUSES.CLOSED && status === CASE_STATUSES.UNDER_INVESTIGATION;
  if (isReopen && !actorRoles.includes(ROLES.ADMINISTRATOR)) {
    throw httpError(403, 'FORBIDDEN', 'Only an administrator can reopen a closed case.');
  }

  const closedAt = status === CASE_STATUSES.CLOSED ? new Date() : isReopen ? null : existing.closed_at;
  const archivedAt = status === CASE_STATUSES.ARCHIVED ? new Date() : existing.archived_at;

  return withTransaction(async (client) => {
    const updated = await repository.updateCaseStatus({ id, status, closedAt, archivedAt }, client);
    await ledger.appendEvent(client, {
      actorUserId,
      action: 'CASE_STATUS_CHANGED',
      resourceType: 'CASE',
      resourceId: id,
      caseId: id,
      result: 'SUCCESS',
      metadata: { from: existing.status, to: status },
    });
    return updated;
  });
}

// --- case_members ---------------------------------------------------------

async function addMember({ actorUserId, caseId, userId, caseRole }) {
  const caseRow = await repository.findCaseById(caseId);
  if (!caseRow) throw httpError(404, 'NOT_FOUND', 'Case not found.');

  const existingMember = await repository.findActiveCaseMember({ caseId, userId });
  if (existingMember) throw httpError(409, 'CONFLICT', 'That user is already a member of this case.');

  return withTransaction(async (client) => {
    const member = await repository.insertCaseMember({ caseId, userId, caseRole, addedBy: actorUserId }, client);
    await ledger.appendEvent(client, {
      actorUserId,
      action: 'CASE_MEMBER_ADDED',
      resourceType: 'CASE',
      resourceId: caseId,
      caseId,
      result: 'SUCCESS',
      metadata: { userId, caseRole },
    });
    return member;
  });
}

async function listMembers(caseId) {
  const caseRow = await repository.findCaseById(caseId);
  if (!caseRow) throw httpError(404, 'NOT_FOUND', 'Case not found.');
  return repository.listCaseMembers(caseId);
}

async function removeMember({ actorUserId, caseId, userId }) {
  const caseRow = await repository.findCaseById(caseId);
  if (!caseRow) throw httpError(404, 'NOT_FOUND', 'Case not found.');

  const member = await repository.findActiveCaseMember({ caseId, userId });
  if (!member) throw httpError(404, 'NOT_FOUND', 'That user is not an active member of this case.');

  if (member.case_role === CASE_ROLES.OWNER) {
    const ownerCount = await repository.countActiveMembersByRole(caseId, CASE_ROLES.OWNER);
    if (ownerCount <= 1) {
      throw httpError(409, 'CANNOT_REMOVE_LAST_OWNER', 'A case must always have at least one owner.');
    }
  }

  return withTransaction(async (client) => {
    await repository.revokeCaseMember({ caseId, userId }, client);
    await ledger.appendEvent(client, {
      actorUserId,
      action: 'CASE_MEMBER_REMOVED',
      resourceType: 'CASE',
      resourceId: caseId,
      caseId,
      result: 'SUCCESS',
      metadata: { userId },
    });
    return { removed: true };
  });
}

module.exports = {
  health,
  createCase,
  getCase,
  listCases,
  updateCase,
  updateCaseStatus,
  addMember,
  listMembers,
  removeMember,
};
