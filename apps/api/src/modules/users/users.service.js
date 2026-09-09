'use strict';

const { randomUUID } = require('crypto');
const repository = require('./users.repository');
const { withTransaction } = require('../../db/pool');
const jwtService = require('../../services/jwt');
const cryptoService = require('../../services/crypto');
const mailService = require('../../services/mail');
const ledger = require('../../services/ledger');
const config = require('../../config');
const { httpError } = require('../../errors');
const { createsRolesFor, parseRole } = require('@secure-dms/shared');

/**
 * STUB — Sprint 0. Business logic for the users module is assembled
 * here in later sprints, following the golden path: authenticate ->
 * authorize -> this service -> persistence+storage -> audit ledger
 * append, all inside one DB transaction. Only a health stub exists now.
 */
async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

/** Any authenticated user may search usernames — see users.repository.searchActiveUsers's doc comment for why this is deliberately minimal/unrestricted. */
async function lookupUsers(query) {
  if (!query || query.trim().length === 0) return [];
  return repository.searchActiveUsers(query.trim());
}

// --- invite / activate (docs/architecture "Feature flow · User invitation & activation") ---

/**
 * The police-hierarchy creation-authority check, shared by inviteUser
 * and createDepartment: resolves the ACTING user's own role+department
 * from the DB (access tokens don't carry department_id — one extra
 * lookup rather than changing the JWT shape), confirms `targetRoleName`
 * is something that role is allowed to create at all
 * (createsRolesFor — own-level `_OFFICER` or a direct child level's
 * `_ADMIN`), and resolves/validates the department the new account
 * belongs to:
 *   - own-level `_OFFICER`: must be the actor's own department.
 *   - child `_ADMIN`: either `departmentId` names an EXISTING direct
 *     child department of the right unit type, or `newUnitName` asks to
 *     create one on the spot (actually created inside the caller's own
 *     transaction — this function only resolves what unit_type/parent
 *     that new department must have, never inserts it itself).
 * A user's `roles` array is treated as exactly one hierarchical
 * position — this system doesn't support dual-hatting.
 *
 * @returns {Promise<{actor: object, existingDepartmentId: string|null,
 *   newDepartment: {name: string, unitType: string, parentDepartmentId: string}|null}>}
 */
async function assertCreationAuthority(actorUser, targetRoleName, { departmentId, newUnitName } = {}) {
  const actorRoleName = (actorUser.roles || [])[0];
  const creatable = createsRolesFor(actorRoleName);
  if (!creatable.includes(targetRoleName)) {
    throw httpError(
      403,
      'FORBIDDEN',
      `Your role (${actorRoleName || 'none'}) may not create ${targetRoleName} accounts.`,
    );
  }

  const actor = await repository.findUserById(actorUser.id);
  if (!actor || !actor.department_id) {
    throw httpError(409, 'CONFLICT', 'Your own account has no department on record — cannot determine creation scope.');
  }

  const targetParsed = parseRole(targetRoleName);

  if (targetParsed.side === 'OFFICER') {
    // Own unit's rank-and-file — always the actor's own department, no picking.
    return { actor, existingDepartmentId: actor.department_id, newDepartment: null };
  }

  // Child _ADMIN: either an existing direct-child department, or a brand new one.
  if (newUnitName) {
    return {
      actor,
      existingDepartmentId: null,
      newDepartment: { name: newUnitName, unitType: targetParsed.level, parentDepartmentId: actor.department_id },
    };
  }
  if (!departmentId) {
    throw httpError(400, 'VALIDATION_ERROR', 'departmentId or newUnitName is required for this role.');
  }
  const targetDept = await repository.findDepartmentById(departmentId);
  if (
    !targetDept ||
    targetDept.parent_department_id !== actor.department_id ||
    targetDept.unit_type !== targetParsed.level
  ) {
    throw httpError(
      403,
      'FORBIDDEN',
      'That unit is not a direct child of your own unit, or is not the right unit type.',
    );
  }
  return { actor, existingDepartmentId: departmentId, newDepartment: null };
}

/**
 * Judgment call (not specified by the bare ER diagram): the inviting
 * admin supplies `username` explicitly, rather than deriving it from
 * the email local-part (avoids uniqueness-collision edge cases).
 */
async function inviteUser({ actorUser, username, email, roleName, departmentId, newUnitName, rank }) {
  const role = await repository.findRoleByName(roleName);
  if (!role) throw httpError(400, 'INVALID_ROLE', `Unknown role: ${roleName}`);

  const authority = await assertCreationAuthority(actorUser, roleName, { departmentId, newUnitName });

  const [existingByUsername, existingByEmail] = await Promise.all([
    repository.findUserByUsername(username),
    repository.findUserByEmail(email),
  ]);
  if (existingByUsername) throw httpError(409, 'CONFLICT', 'That username is already taken.');
  if (existingByEmail) throw httpError(409, 'CONFLICT', 'That email is already registered.');

  const { raw, hash } = jwtService.generateOpaqueToken();
  const expiresAt = new Date(Date.now() + jwtService.parseDuration(config.auth.invitationTtl));

  const newUser = await withTransaction(async (client) => {
    let resolvedDepartmentId = authority.existingDepartmentId;
    if (authority.newDepartment) {
      const dept = await repository.insertDepartment(
        {
          name: authority.newDepartment.name,
          code: `${authority.newDepartment.unitType}-${randomUUID()}`,
          parentDepartmentId: authority.newDepartment.parentDepartmentId,
          unitType: authority.newDepartment.unitType,
        },
        client,
      );
      resolvedDepartmentId = dept.id;
    }

    const user = await repository.insertUser(
      {
        username,
        email,
        passwordHash: null,
        fullName: null,
        status: 'INVITED',
        departmentId: resolvedDepartmentId,
      },
      client,
    );
    if (rank) {
      await repository.setUserRank(user.id, rank, client);
    }
    await repository.insertUserInvitation(
      { email, invitedBy: actorUser.id, roleId: role.id, departmentId: resolvedDepartmentId, tokenHash: hash, expiresAt },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'USER_INVITED',
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { email, roleName, departmentId: resolvedDepartmentId },
    });
    return user;
  });

  const activationUrl = `${config.app.baseUrl}/activate/${raw}`;
  // Never throws — degrades to a logged no-op if SMTP isn't configured/reachable.
  await mailService.sendInvitationEmail({ to: email, activationUrl });

  return {
    userId: newUser.id,
    email,
    status: 'INVITED',
    // Dev/test convenience only — never persisted, never returned in production.
    ...(config.server.nodeEnv !== 'production' ? { activationToken: raw, activationUrl } : {}),
  };
}

async function previewInvitation(token) {
  const invitation = await findValidInvitationOrThrow(token);
  const [role, department] = await Promise.all([
    repository.findRoleById(invitation.role_id),
    invitation.department_id ? repository.findDepartmentById(invitation.department_id) : null,
  ]);
  return {
    email: invitation.email,
    roleName: role ? role.name : null,
    departmentName: department ? department.name : null,
    expiresAt: invitation.expires_at,
  };
}

async function activateAccount({ token, password, fullName }) {
  const invitation = await findValidInvitationOrThrow(token);

  const user = await repository.findUserByEmail(invitation.email);
  if (!user || user.status !== 'INVITED') {
    throw httpError(410, 'INVITATION_INVALID', 'This invitation is no longer valid.');
  }

  const passwordHash = await cryptoService.hashPassword(password);

  await withTransaction(async (client) => {
    await repository.setUserPasswordAndActivate({ id: user.id, passwordHash, fullName }, client);
    await repository.insertUserRole({ userId: user.id, roleId: invitation.role_id }, client);
    await repository.markInvitationAccepted(invitation.id, client);
    await ledger.appendEvent(client, {
      actorUserId: user.id,
      action: 'USER_ACTIVATED',
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
    });
  });

  return { message: 'Account activated.' };
}

async function findValidInvitationOrThrow(token) {
  const tokenHash = jwtService.hashOpaqueToken(token);
  const invitation = await repository.findInvitationByTokenHash(tokenHash);
  if (
    !invitation ||
    invitation.status !== 'PENDING' ||
    new Date(invitation.expires_at).getTime() < Date.now()
  ) {
    throw httpError(410, 'INVITATION_INVALID', 'This invitation link is invalid or has expired.');
  }
  return invitation;
}

// --- user management ---------------------------------------------------

/**
 * Any `_ADMIN` role may only see/manage accounts within its own unit's
 * subtree (STATE_HQ_ADMIN's own department is the tree's root, so its
 * subtree is naturally everything — no special-casing needed). Shared by
 * listUsers/updateUserStatus/updateUserRoles.
 */
async function assertManagementAuthority(actorUser, targetDepartmentId) {
  const actor = await repository.findUserById(actorUser.id);
  if (!actor || !actor.department_id) {
    throw httpError(409, 'CONFLICT', 'Your own account has no department on record — cannot determine management scope.');
  }
  if (!targetDepartmentId) return actor; // target has no department yet — nothing to scope against
  const within = await repository.isDepartmentWithinSubtree(actor.department_id, targetDepartmentId);
  if (!within) {
    throw httpError(403, 'FORBIDDEN', 'That account is outside your unit’s chain of command.');
  }
  return actor;
}

async function listUsers(actorUser, filters) {
  const actor = await repository.findUserById(actorUser.id);
  if (!actor || !actor.department_id) return [];
  const subtree = await repository.findDepartmentsWithinSubtree(actor.department_id);
  return repository.listUsers({ ...filters, departmentIds: subtree.map((d) => d.id) });
}

async function getUser(id) {
  const user = await repository.findUserById(id);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found.');
  const roles = await repository.findRoleNamesForUser(id);
  return { ...toPublicUser(user), roles };
}

async function updateUserStatus({ actorUser, targetId, status }) {
  const target = await repository.findUserById(targetId);
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found.');
  await assertManagementAuthority(actorUser, target.department_id);

  await withTransaction(async (client) => {
    await repository.setUserStatus(targetId, status, client);
    // Covers admin-unlock: LOCKED -> ACTIVE also resets the failed count.
    if (status === 'ACTIVE') {
      await repository.resetFailedLoginCount(targetId, client);
    }
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'USER_STATUS_CHANGED',
      resourceType: 'user',
      resourceId: targetId,
      result: 'SUCCESS',
      metadata: { from: target.status, to: status },
    });
  });

  return getUser(targetId);
}

async function updateUserRoles({ actorUser, targetId, roleNames }) {
  const target = await repository.findUserById(targetId);
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found.');
  await assertManagementAuthority(actorUser, target.department_id);

  const roles = await repository.findRoleIdsByNames(roleNames);
  if (roles.length !== roleNames.length) {
    throw httpError(400, 'INVALID_ROLE', 'One or more role names are unknown.');
  }

  await withTransaction(async (client) => {
    await repository.replaceUserRoles({ userId: targetId, roleIds: roles.map((r) => r.id) }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'USER_ROLES_CHANGED',
      resourceType: 'user',
      resourceId: targetId,
      result: 'SUCCESS',
      metadata: { roleNames },
    });
  });

  return getUser(targetId);
}

async function listDepartments() {
  return repository.listDepartments();
}

/**
 * Direct, standalone unit creation (as opposed to inviteUser's inline
 * `newUnitName` shortcut) — always a child of the ACTOR's own
 * department; `unitType` must be a level their role is actually
 * authorized to create an admin for (createsRolesFor), so a unit can
 * never be created "floating" with no matching admin role to ever
 * manage it.
 */
async function createDepartment({ actorUser, name, unitType }) {
  const actorRoleName = (actorUser.roles || [])[0];
  const creatable = createsRolesFor(actorRoleName);
  if (!creatable.includes(`${unitType}_ADMIN`)) {
    throw httpError(403, 'FORBIDDEN', `Your role may not create a ${unitType} unit.`);
  }
  const actor = await repository.findUserById(actorUser.id);
  if (!actor || !actor.department_id) {
    throw httpError(409, 'CONFLICT', 'Your own account has no department on record.');
  }
  return repository.insertDepartment({
    name,
    code: `${unitType}-${randomUUID()}`,
    parentDepartmentId: actor.department_id,
    unitType,
  });
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    status: user.status,
    departmentId: user.department_id,
    mfaEnabled: user.mfa_enabled,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

module.exports = {
  health,
  lookupUsers,
  inviteUser,
  previewInvitation,
  activateAccount,
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRoles,
  listDepartments,
  createDepartment,
};
