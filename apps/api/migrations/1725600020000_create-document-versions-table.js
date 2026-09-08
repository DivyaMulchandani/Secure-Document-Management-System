'use strict';

exports.shorthands = undefined;

/**
 * feature 6, 7 — immutable, hashed, encrypted revisions. Never
 * overwritten in place; a correction always inserts a new row (see
 * documents.service.js's uploadNewVersion / restoreVersion).
 *
 * `integrity_status` defaults to UNKNOWN, not VERIFIED, matching the
 * architecture's own INTEGRITY state diagram exactly ([*] -> UNKNOWN,
 * UNKNOWN -> VERIFIED on a matching hash check) — the hash IS captured
 * correctly at upload, but the state machine only moves to VERIFIED
 * once an explicit check has actually happened (the first
 * access/download re-hash).
 */
exports.up = (pgm) => {
  pgm.createTable('document_versions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: {
      type: 'uuid',
      notNull: true,
      references: 'documents',
      onDelete: 'CASCADE',
    },
    version_number: { type: 'varchar(12)', notNull: true },
    storage_key: { type: 'text', notNull: true },
    sha256_hash: { type: 'char(64)', notNull: true },
    file_name: { type: 'varchar(255)', notNull: true },
    mime_type: { type: 'varchar(255)', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    encryption_version: { type: 'varchar(32)', notNull: true },
    key_id: { type: 'varchar(64)', notNull: true },
    integrity_status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'UNKNOWN',
      check: "integrity_status IN ('VERIFIED','MODIFIED','UNKNOWN')",
    },
    is_signed: { type: 'boolean', notNull: true, default: false },
    change_note: { type: 'text' },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('document_versions', 'document_id');
  // Backs duplicate-detection lookups (find other versions in the same
  // case sharing this exact content hash) — see
  // documents.repository.findVersionsByHashInCase.
  pgm.createIndex('document_versions', 'sha256_hash');
};

exports.down = (pgm) => {
  pgm.dropTable('document_versions');
};
