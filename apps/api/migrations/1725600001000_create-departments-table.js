'use strict';

exports.shorthands = undefined;

/**
 * Empty for Sprint 0 — the identity domain (users, roles, invitations)
 * fills this in a later sprint. Created now because roles/users
 * reference it (docs/architecture — "Domain · Identity & access").
 */
exports.up = (pgm) => {
  pgm.createTable('departments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'varchar(160)', notNull: true },
    code: { type: 'varchar(32)', notNull: true, unique: true },
    parent_department_id: {
      type: 'uuid',
      references: 'departments',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('departments');
};
