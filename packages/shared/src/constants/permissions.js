'use strict';

/**
 * Fine-grained permission codes (feature 17 — access control). Mirrors
 * the `permissions` table seed data
 * (apps/api/migrations/*_seed-permissions.js) — keep in sync manually.
 * @see docs/architecture — "Domain · Identity & access"
 */
const PERMISSIONS = Object.freeze({
  VIEW: 'VIEW',
  UPLOAD: 'UPLOAD',
  EDIT: 'EDIT',
  DOWNLOAD: 'DOWNLOAD',
  SHARE: 'SHARE',
  COMMENT: 'COMMENT',
  SIGN: 'SIGN',
  VERIFY: 'VERIFY',
  DELETE: 'DELETE',
  ARCHIVE: 'ARCHIVE',
});

const PERMISSION_LIST = Object.freeze(Object.values(PERMISSIONS));

module.exports = { PERMISSIONS, PERMISSION_LIST };
