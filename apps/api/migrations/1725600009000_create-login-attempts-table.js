'use strict';

exports.shorthands = undefined;

/**
 * feature 1 — feeds lockout + security alerts. Exactly the fields given
 * in the architecture's ER diagram, no extra columns invented.
 */
exports.up = (pgm) => {
  pgm.createTable('login_attempts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    }, // nullable if unknown username
    username_tried: { type: 'varchar(64)', notNull: true },
    ip_address: { type: 'varchar(64)' },
    success: { type: 'boolean', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('login_attempts');
};
