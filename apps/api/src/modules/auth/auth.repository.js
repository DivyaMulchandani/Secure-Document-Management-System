'use strict';

const { pool } = require('../../db/pool');
const usersRepository = require('../users/users.repository');

/**
 * Owns SQL for `auth_sessions`, `login_attempts`, and `mfa_credentials`
 * only. Imports the user-table primitives it needs from
 * users.repository.js (which owns `users`) rather than duplicating SQL —
 * see the data-ownership note there.
 */

// --- health (kept from the Sprint 0 stub route) ---------------------------

async function healthCheck() {
  return { module: 'auth' };
}

// --- login_attempts ---------------------------------------------------

async function insertLoginAttempt({ userId = null, usernameTried, ipAddress = null, success }, executor = pool) {
  await executor.query(
    `INSERT INTO login_attempts (user_id, username_tried, ip_address, success)
     VALUES ($1,$2,$3,$4)`,
    [userId, usernameTried, ipAddress, success],
  );
}

// --- auth_sessions ------------------------------------------------------

async function insertAuthSession(
  { userId, refreshTokenHash, expiresAt, ipAddress = null, userAgent = null },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [userId, refreshTokenHash, expiresAt, ipAddress, userAgent],
  );
  return rows[0];
}

async function findSessionByHash(refreshTokenHash, executor = pool) {
  const { rows } = await executor.query(
    'SELECT * FROM auth_sessions WHERE refresh_token_hash = $1',
    [refreshTokenHash],
  );
  return rows[0] || null;
}

async function revokeSessionByHash(refreshTokenHash, executor = pool) {
  await executor.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL',
    [refreshTokenHash],
  );
}

// --- mfa_credentials ------------------------------------------------------

async function findLatestUnverifiedMfaCredential(userId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT * FROM mfa_credentials
     WHERE user_id = $1 AND verified = false
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function deleteUnverifiedMfaCredentials(userId, executor = pool) {
  await executor.query('DELETE FROM mfa_credentials WHERE user_id = $1 AND verified = false', [
    userId,
  ]);
}

async function insertMfaCredential({ userId, type, secret }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO mfa_credentials (user_id, type, secret) VALUES ($1,$2,$3) RETURNING id`,
    [userId, type, secret],
  );
  return rows[0];
}

async function markMfaCredentialVerified(id, executor = pool) {
  await executor.query('UPDATE mfa_credentials SET verified = true WHERE id = $1', [id]);
}

async function findVerifiedMfaCredential(userId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT * FROM mfa_credentials WHERE user_id = $1 AND verified = true
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

module.exports = {
  healthCheck,
  insertLoginAttempt,
  insertAuthSession,
  findSessionByHash,
  revokeSessionByHash,
  findLatestUnverifiedMfaCredential,
  deleteUnverifiedMfaCredentials,
  insertMfaCredential,
  markMfaCredentialVerified,
  findVerifiedMfaCredential,
  // Re-exported user-table primitives — owned by users.repository.js.
  findUserByUsername: usersRepository.findUserByUsername,
  findUserById: usersRepository.findUserById,
  findRoleNamesForUser: usersRepository.findRoleNamesForUser,
  setUserStatus: usersRepository.setUserStatus,
  resetFailedLoginCount: usersRepository.resetFailedLoginCount,
  incrementFailedLoginCount: usersRepository.incrementFailedLoginCount,
  setLastLoginAt: usersRepository.setLastLoginAt,
  setMfaEnabled: usersRepository.setMfaEnabled,
};
