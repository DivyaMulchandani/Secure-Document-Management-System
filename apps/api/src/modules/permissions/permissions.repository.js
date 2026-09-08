'use strict';

const { pool } = require('../../db/pool');

/**
 * Owns SQL for the `resource_permissions` table (the third, finest-
 * grained layer of the access model). `permissions` (the fixed
 * VIEW/UPLOAD/EDIT/... catalogue) is read-only reference data already
 * seeded in Sprint 0 — this module only reads it to resolve codes.
 */

async function healthCheck() {
  return { module: 'permissions' };
}

async function findPermissionByCode(code, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM permissions WHERE code = $1', [code]);
  return rows[0] || null;
}

async function insertGrant(
  { resourceType, resourceId, userId, permissionId, grantedBy = null, expiresAt = null },
  executor = pool,
) {
  const { rows } = await executor.query(
    `INSERT INTO resource_permissions
       (resource_type, resource_id, user_id, permission_id, granted_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [resourceType, resourceId, userId, permissionId, grantedBy, expiresAt],
  );
  return rows[0];
}

async function findGrantById(id, executor = pool) {
  const { rows } = await executor.query('SELECT * FROM resource_permissions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listGrantsForResource({ resourceType, resourceId }, executor = pool) {
  const { rows } = await executor.query(
    `SELECT rp.*, p.code AS permission_code, u.username, u.full_name
     FROM resource_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     JOIN users u ON u.id = rp.user_id
     WHERE rp.resource_type = $1 AND rp.resource_id = $2
       AND rp.revoked_at IS NULL
       AND (rp.expires_at IS NULL OR rp.expires_at > now())
     ORDER BY rp.created_at DESC`,
    [resourceType, resourceId],
  );
  return rows;
}

async function revokeGrant(id, executor = pool) {
  await executor.query('UPDATE resource_permissions SET revoked_at = now() WHERE id = $1', [id]);
}

module.exports = {
  healthCheck,
  findPermissionByCode,
  insertGrant,
  findGrantById,
  listGrantsForResource,
  revokeGrant,
};
