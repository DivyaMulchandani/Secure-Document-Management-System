'use strict';

exports.shorthands = undefined;

/**
 * feature 1, 2 — accounts.
 *
 * Deviation from the literal architecture field list, flagged explicitly:
 * the architecture marks password_hash/full_name NOT NULL, but the
 * INVITE -> ACTIVATE flow requires inserting a status=INVITED row before
 * either exists. Both are nullable at the DB layer here; the app enforces
 * them in practice once status moves past INVITED (see users.service.js).
 */
exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    username: { type: 'varchar(64)', notNull: true, unique: true },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'text' }, // nullable — see deviation note above
    full_name: { type: 'varchar(160)' }, // nullable — see deviation note above
    department_id: {
      type: 'uuid',
      references: 'departments',
      onDelete: 'SET NULL',
    },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'INVITED',
      check: "status IN ('INVITED','ACTIVE','INACTIVE','LOCKED')",
    },
    failed_login_count: { type: 'integer', notNull: true, default: 0 },
    mfa_enabled: { type: 'boolean', notNull: true, default: false },
    last_login_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
