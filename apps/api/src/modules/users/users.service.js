'use strict';

const repository = require('./users.repository');
const { withTransaction } = require('../../db/pool');
const jwtService = require('../../services/jwt');
const cryptoService = require('../../services/crypto');
const mailService = require('../../services/mail');
const ledger = require('../../services/ledger');
const config = require('../../config');
const { httpError } = require('../../errors');

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

// --- invite / activate (docs/architecture "Feature flow · User invitation & activation") ---

/**
 * Judgment call (not specified by the bare ER diagram): the inviting
 * admin supplies `username` explicitly, rather than deriving it from
 * the email local-part (avoids uniqueness-collision edge cases).
 */
async function inviteUser({ invitedByUserId, username, email, roleName, departmentId }) {
  const role = await repository.findRoleByName(roleName);
  if (!role) throw httpError(400, 'INVALID_ROLE', `Unknown role: ${roleName}`);

  const [existingByUsername, existingByEmail] = await Promise.all([
    repository.findUserByUsername(username),
    repository.findUserByEmail(email),
  ]);
  if (existingByUsername) throw httpError(409, 'CONFLICT', 'That username is already taken.');
  if (existingByEmail) throw httpError(409, 'CONFLICT', 'That email is already registered.');

  const { raw, hash } = jwtService.generateOpaqueToken();
  const expiresAt = new Date(Date.now() + jwtService.parseDuration(config.auth.invitationTtl));

  const newUser = await withTransaction(async (client) => {
    const user = await repository.insertUser(
      { username, email, passwordHash: null, fullName: null, status: 'INVITED', departmentId },
      client,
    );
    await repository.insertUserInvitation(
      { email, invitedBy: invitedByUserId, roleId: role.id, departmentId, tokenHash: hash, expiresAt },
      client,
    );
    await ledger.appendEvent(client, {
      actorUserId: invitedByUserId,
      action: 'USER_INVITED',
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { email, roleName },
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

async function listUsers(filters) {
  return repository.listUsers(filters);
}

async function getUser(id) {
  const user = await repository.findUserById(id);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found.');
  const roles = await repository.findRoleNamesForUser(id);
  return { ...toPublicUser(user), roles };
}

async function updateUserStatus({ adminId, targetId, status }) {
  const target = await repository.findUserById(targetId);
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found.');

  await withTransaction(async (client) => {
    await repository.setUserStatus(targetId, status, client);
    // Covers admin-unlock: LOCKED -> ACTIVE also resets the failed count.
    if (status === 'ACTIVE') {
      await repository.resetFailedLoginCount(targetId, client);
    }
    await ledger.appendEvent(client, {
      actorUserId: adminId,
      action: 'USER_STATUS_CHANGED',
      resourceType: 'user',
      resourceId: targetId,
      result: 'SUCCESS',
      metadata: { from: target.status, to: status },
    });
  });

  return getUser(targetId);
}

async function updateUserRoles({ adminId, targetId, roleNames }) {
  const target = await repository.findUserById(targetId);
  if (!target) throw httpError(404, 'NOT_FOUND', 'User not found.');

  const roles = await repository.findRoleIdsByNames(roleNames);
  if (roles.length !== roleNames.length) {
    throw httpError(400, 'INVALID_ROLE', 'One or more role names are unknown.');
  }

  await withTransaction(async (client) => {
    await repository.replaceUserRoles({ userId: targetId, roleIds: roles.map((r) => r.id) }, client);
    await ledger.appendEvent(client, {
      actorUserId: adminId,
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

async function createDepartment({ name, code, parentDepartmentId }) {
  return repository.insertDepartment({ name, code, parentDepartmentId });
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
