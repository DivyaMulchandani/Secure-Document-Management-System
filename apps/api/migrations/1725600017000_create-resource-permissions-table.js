'use strict';

exports.shorthands = undefined;

/**
 * feature 17 — the third (and finest-grained) layer of the access
 * model: an explicit, optionally-expiring exception on ONE resource,
 * independent of case membership (e.g. "Prosecutor gets VIEW on one
 * report for 72h" even though they're not a case member).
 *
 * resource_id is polymorphic (no FK possible — resource_type says which
 * table it points into), matching the architecture's own design.
 */
exports.up = (pgm) => {
  pgm.createTable('resource_permissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    resource_type: {
      type: 'varchar(16)',
      notNull: true,
      check: "resource_type IN ('CASE','DOCUMENT','EVIDENCE','REPORT')",
    },
    resource_id: { type: 'uuid', notNull: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    permission_id: {
      type: 'uuid',
      notNull: true,
      references: 'permissions',
      onDelete: 'CASCADE',
    },
    granted_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    expires_at: { type: 'timestamptz' }, // null = permanent
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('resource_permissions', ['resource_type', 'resource_id']);
  pgm.createIndex('resource_permissions', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('resource_permissions');
};
