'use strict';

exports.shorthands = undefined;

/**
 * feature 4 — the logical document record.
 *
 * Two deliberate scope narrowings vs. the full architecture field list,
 * flagged explicitly: `retention_policy_id` and `legal_hold` are
 * omitted this sprint (feature 23 — retention/archival — hasn't landed
 * yet, and `retention_policies` doesn't exist as a table); both will be
 * added in that sprint, matching how `case_id` was added to
 * `audit_events` only once `cases` existed (see
 * 1725600018000_add-case-fk-to-audit-events.js).
 *
 * `current_version_id` is a plain column with NO FK yet — document_versions
 * (which it points into) is created in the NEXT migration, and
 * document_versions.document_id points back at THIS table, so the FK on
 * current_version_id is added afterward in
 * 1725600021000_add-current-version-fk-to-documents.js.
 */
exports.up = (pgm) => {
  pgm.createTable('documents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: {
      type: 'uuid',
      notNull: true,
      references: 'cases',
      onDelete: 'RESTRICT',
    },
    document_type_id: {
      type: 'uuid',
      references: 'document_types',
      onDelete: 'SET NULL',
    },
    title: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'ACTIVE',
      check:
        "status IN ('DRAFT','ACTIVE','UNDER_REVIEW','APPROVED','SIGNED','FINAL','ARCHIVED','DELETED')",
    },
    current_version_id: { type: 'uuid' }, // FK added once document_versions exists — see note above
    is_final: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    archived_at: { type: 'timestamptz' },
  });

  pgm.createIndex('documents', 'case_id');
  pgm.createIndex('documents', 'status');
};

exports.down = (pgm) => {
  pgm.dropTable('documents');
};
