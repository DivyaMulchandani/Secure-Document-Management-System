'use strict';

exports.shorthands = undefined;

/**
 * feature 2 — invite/activate workflow.
 *
 * `token` stores the HASH of the opaque activation token, never the raw
 * value (the raw token only ever appears in the email link / dev-mode API
 * response, see users.service.js).
 *
 * Deliberately no `user_id` column here (not in the given ER field list)
 * — activation re-resolves the target user by `email`, not by FK.
 */
exports.up = (pgm) => {
  pgm.createTable('user_invitations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true },
    invited_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    role_id: {
      type: 'uuid',
      notNull: true,
      references: 'roles',
      onDelete: 'RESTRICT',
    },
    department_id: {
      type: 'uuid',
      references: 'departments',
      onDelete: 'SET NULL',
    },
    token: { type: 'text', notNull: true, unique: true },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')",
    },
    expires_at: { type: 'timestamptz', notNull: true },
    accepted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('user_invitations');
};
