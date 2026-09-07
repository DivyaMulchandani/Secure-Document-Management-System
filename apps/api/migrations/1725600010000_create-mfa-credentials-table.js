'use strict';

exports.shorthands = undefined;

/**
 * Optional MFA/OTP support (feature 1). `created_at` is one deliberate
 * addition beyond the bare ER list — needed to deterministically pick
 * "the latest unverified row" when a user re-enrolls before verifying.
 */
exports.up = (pgm) => {
  pgm.createTable('mfa_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    type: {
      type: 'varchar(8)',
      notNull: true,
      check: "type IN ('TOTP','OTP')",
    },
    secret: { type: 'text', notNull: true },
    verified: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('mfa_credentials');
};
