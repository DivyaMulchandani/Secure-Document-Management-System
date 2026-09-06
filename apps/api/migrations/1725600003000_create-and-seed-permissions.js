'use strict';

exports.shorthands = undefined;

/**
 * Seed values mirror packages/shared/src/constants/permissions.js — keep
 * the two in sync manually (docs/architecture — "Fine-Grained Access
 * Control").
 */
exports.up = (pgm) => {
  pgm.createTable('permissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'varchar(32)', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('VIEW', 'May view/read a resource.'),
      ('UPLOAD', 'May upload a new document or version.'),
      ('EDIT', 'May edit resource metadata.'),
      ('DOWNLOAD', 'May download the underlying bytes.'),
      ('SHARE', 'May grant access to another user.'),
      ('COMMENT', 'May add comments/annotations.'),
      ('SIGN', 'May digitally sign a document version.'),
      ('VERIFY', 'May run integrity/signature/custody verification.'),
      ('DELETE', 'May delete a resource (authorized only).'),
      ('ARCHIVE', 'May archive a resource.')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions
    WHERE code IN ('VIEW', 'UPLOAD', 'EDIT', 'DOWNLOAD', 'SHARE', 'COMMENT', 'SIGN', 'VERIFY', 'DELETE', 'ARCHIVE');
  `);
  pgm.dropTable('permissions');
};
