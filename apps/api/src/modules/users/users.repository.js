'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns all SQL for `users`, `user_roles`, `departments`, and
 * `user_invitations`. auth.repository.js imports the handful of
 * user-lookup/update functions it needs from here rather than
 * duplicating SQL (see docs comment there).
 *
 * Every write-capable function takes an optional trailing
 * `executor = pool` — pass a transaction `client` (from
 * db/pool.js's withTransaction) to run it as part of a larger
 * transaction, or call it standalone against the pool.
 */

// --- health (kept from the Sprint 0 stub route) ---------------------------

async function healthCheck() {
  return { module: 'users' };
}

// --- users ---------------------------------------------------------------

async function insertUser(
  { username, email, passwordHash = null, fullName = null, status = 'INVITED', departmentId = null },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO users (username, email, password_hash, full_name, status, department_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, username, email, status`,
    [username, email, passwordHash, fullName, status, departmentId],
  );
  return rows[0];
}

async function findUserByUsername(username, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function findUserByEmail(email, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findUserById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listUsers({ status, departmentId, page = 1, pageSize = 20 } = {}, executor = pool) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`u.status = $${params.length}`);
  }
  if (departmentId) {
    params.push(departmentId);
    conditions.push(`u.department_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await executor.query(
    `SELECT u.id, u.username, u.email, u.full_name, u.status, u.department_id,
            d.name AS department_name, u.mfa_enabled, u.failed_login_count,
            u.last_login_at, u.created_at,
            COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     ${where}
     GROUP BY u.id, d.name
     ORDER BY u.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

async function setUserStatus(id, status, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE users SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status`,
    [status, id],
  );
  return rows[0] || null;
}

async function resetFailedLoginCount(id, executor = pool) {
  await executor.query('UPDATE users SET failed_login_count = 0, updated_at = now() WHERE id = $1', [
    id,
  ]);
}

async function incrementFailedLoginCount(id, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE users SET failed_login_count = failed_login_count + 1, updated_at = now()
     WHERE id = $1 RETURNING failed_login_count`,
    [id],
  );
  return rows[0].failed_login_count;
}

async function setLastLoginAt(id, executor = pool) {
  await executor.query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [
    id,
  ]);
}

async function setUserPasswordAndActivate({ id, passwordHash, fullName }, executor = pool) {
  await executor.query(
    `UPDATE users
     SET password_hash = $1, full_name = $2, status = 'ACTIVE', updated_at = now()
     WHERE id = $3`,
    [passwordHash, fullName, id],
  );
}

async function setMfaEnabled(id, enabled, executor = pool) {
  await executor.query('UPDATE users SET mfa_enabled = $1, updated_at = now() WHERE id = $2', [
    enabled,
    id,
  ]);
}

// --- roles / user_roles ---------------------------------------------------

async function findRoleByName(name, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM roles WHERE name = $1', [name]);
  return rows[0] || null;
}

async function findRoleById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM roles WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findRoleIdsByNames(names, executor = pool) {
  const { rows } = await executor.query('SELECT id, name FROM roles WHERE name = ANY($1::text[])', [
    names,
  ]);
  return rows;
}

async function findRoleNamesForUser(userId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.name);
}

async function insertUserRole({ userId, roleId }, executor = pool) {
  await executor.query(
    'INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [userId, roleId],
  );
}

async function replaceUserRoles({ userId, roleIds }, executor = pool) {
  await executor.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  await Promise.all(roleIds.map((roleId) => insertUserRole({ userId, roleId }, executor)));
}

// --- user_invitations -------------------------------------------------------

async function insertUserInvitation(
  { email, invitedBy, roleId, departmentId = null, tokenHash, expiresAt },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO user_invitations (email, invited_by, role_id, department_id, token, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,'PENDING',$6)
     RETURNING id`,
    [email, invitedBy, roleId, departmentId, tokenHash, expiresAt],
  );
  return rows[0];
}

async function findInvitationByTokenHash(tokenHash, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM user_invitations WHERE token = $1', [
    tokenHash,
  ]);
  return rows[0] || null;
}

async function markInvitationAccepted(id, executor = pool) {
  await executor.query(
    "UPDATE user_invitations SET status = 'ACCEPTED', accepted_at = now() WHERE id = $1",
    [id],
  );
}

// --- departments -----------------------------------------------------------

async function listDepartments(executor = pool) {
  const { rows } = await executor.query('SELECT * FROM departments ORDER BY name');
  return rows;
}

async function findDepartmentById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM departments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function insertDepartment({ name, code, parentDepartmentId = null }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO departments (name, code, parent_department_id) VALUES ($1,$2,$3) RETURNING *`,
    [name, code, parentDepartmentId],
  );
  return rows[0];
}

module.exports = {
  healthCheck,
  insertUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  listUsers,
  setUserStatus,
  resetFailedLoginCount,
  incrementFailedLoginCount,
  setLastLoginAt,
  setUserPasswordAndActivate,
  setMfaEnabled,
  findRoleByName,
  findRoleById,
  findRoleIdsByNames,
  findRoleNamesForUser,
  insertUserRole,
  replaceUserRoles,
  insertUserInvitation,
  findInvitationByTokenHash,
  markInvitationAccepted,
  listDepartments,
  findDepartmentById,
  insertDepartment,
};
