'use strict';

exports.shorthands = undefined;

/**
 * feature 15 — secure, time-limited document sharing. This is
 * deliberately a thin, document-focused record layered on top of the
 * SAME `resource_permissions` primitive built in Sprint 2 (feature 17 —
 * that table's own doc comment gives the exact example: "Prosecutor
 * gets VIEW on one report for 72h even though they're not a case
 * member") — sharing doesn't invent a second access-control mechanism,
 * it just gives the existing one a document-shaped front end plus its
 * own audit trail (`shared_by`/`shared_with`/`reason`, none of which
 * resource_permissions itself carries).
 *
 * `resource_permission_id` is the ONE enforcement row this share
 * created — actual access (can a recipient view/download the document)
 * flows entirely through the existing three-layer engine's layer 3
 * (services/permissions.checkResourceGrant), which already excludes
 * expired/revoked grants. That's what makes "auto-revoke" free: once
 * `resource_permissions.expires_at` passes, checkResourceGrant simply
 * stops matching — no scheduler/cron needed.
 *
 * `permission_code`/`expires_at` are write-once denormalized copies of
 * the linked resource_permissions row (set together, at creation, and
 * never updated afterward) purely so "list my shares" doesn't need a
 * join for the common case; live status (ACTIVE/EXPIRED/REVOKED) is
 * ALWAYS computed by joining resource_permissions.revoked_at — the only
 * field that can change after creation — never duplicated here, so
 * there's nothing that can drift out of sync.
 */
exports.up = (pgm) => {
  pgm.createTable('document_shares', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: {
      type: 'uuid',
      notNull: true,
      references: 'documents',
      onDelete: 'RESTRICT',
    },
    resource_permission_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'resource_permissions',
      onDelete: 'RESTRICT',
    },
    shared_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    shared_with: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    permission_code: {
      type: 'varchar(16)',
      notNull: true,
      check: "permission_code IN ('VIEW','DOWNLOAD')", // sharing is deliberately read-only, never EDIT/UPLOAD/etc.
    },
    reason: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true }, // sharing is always time-limited — unlike a generic resource_permissions grant, a share with no expiry isn't offered
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('document_shares', 'document_id');
  pgm.createIndex('document_shares', 'shared_with');
};

exports.down = (pgm) => {
  pgm.dropTable('document_shares');
};
