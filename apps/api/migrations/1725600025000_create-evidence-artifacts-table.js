'use strict';

exports.shorthands = undefined;

/**
 * feature 12 — the hashed, encrypted files attached to one evidence
 * record (one evidence item may have several artifacts — e.g. multiple
 * photos of a seized item). Immutable once created: unlike documents,
 * evidence artifacts have no version/restore concept — tampering must
 * be DETECTED (integrity_status), never "corrected" with a new upload.
 *
 * Deliberately no created_by column — not in the architecture's field
 * list for this table (accountability for evidence actions lives on
 * evidence.created_by and on custody_events/audit_events instead).
 */
exports.up = (pgm) => {
  pgm.createTable('evidence_artifacts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    evidence_id: {
      type: 'uuid',
      notNull: true,
      references: 'evidence',
      onDelete: 'CASCADE',
    },
    storage_key: { type: 'text', notNull: true },
    sha256_hash: { type: 'char(64)', notNull: true },
    file_name: { type: 'varchar(255)', notNull: true },
    mime_type: { type: 'varchar(255)', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    integrity_status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'UNKNOWN',
      check: "integrity_status IN ('VERIFIED','MODIFIED','UNKNOWN')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('evidence_artifacts', 'evidence_id');
};

exports.down = (pgm) => {
  pgm.dropTable('evidence_artifacts');
};
