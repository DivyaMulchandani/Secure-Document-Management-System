'use strict';

exports.shorthands = undefined;

/**
 * feature 12 — Evidence Vault. Status enum matches
 * docs/architecture's EVIDENCE state machine exactly:
 * REGISTERED -> SEALED -> VERIFIED -> IN_CUSTODY <-> IN_TRANSIT ->
 * RECEIVED -> UNDER_ANALYSIS -> IN_CUSTODY -> RETURNED -> ARCHIVED.
 */
exports.up = (pgm) => {
  pgm.createTable('evidence', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: {
      type: 'uuid',
      notNull: true,
      references: 'cases',
      onDelete: 'RESTRICT',
    },
    evidence_number: { type: 'varchar(40)', notNull: true, unique: true },
    title: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    category: { type: 'varchar(100)' },
    status: {
      type: 'varchar(24)',
      notNull: true,
      default: 'REGISTERED',
      check:
        "status IN ('REGISTERED','SEALED','VERIFIED','IN_CUSTODY','IN_TRANSIT','RECEIVED','UNDER_ANALYSIS','RETURNED','ARCHIVED')",
    },
    current_custodian_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    current_location: { type: 'varchar(255)' },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('evidence', 'case_id');
  pgm.createIndex('evidence', 'status');
  pgm.createIndex('evidence', 'current_custodian_id');
};

exports.down = (pgm) => {
  pgm.dropTable('evidence');
};
