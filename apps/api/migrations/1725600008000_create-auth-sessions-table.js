'use strict';

exports.shorthands = undefined;

/**
 * feature 1 — refresh-token sessions. `refresh_token_hash` is the SHA-256
 * of the opaque refresh token handed to the client (httpOnly cookie); only
 * the hash is ever stored, so a session can be revoked without needing the
 * raw token back.
 */
exports.up = (pgm) => {
  pgm.createTable('auth_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    refresh_token_hash: { type: 'text', notNull: true, unique: true },
    issued_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    ip_address: { type: 'varchar(64)' },
    user_agent: { type: 'varchar(255)' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('auth_sessions');
};
