'use strict';

exports.shorthands = undefined;

/**
 * feature 13 — the four-check verification portal's audit trail
 * (docs/architecture "Feature flow · Document verification"): every
 * time anyone (internal, authenticated user OR an external/public
 * verifier via a verification_code) runs the hash / signature / ledger
 * / version checks against a signed document, one row is written here.
 * Only ever written for a document that HAS a signature to check —
 * "this document has never been signed" is a lightweight response the
 * service returns without a row here (there's nothing meaningful to
 * log a four-check breakdown for).
 *
 * `overall_result` is a fourth state beyond plain authentic/tampered
 * that falls straight out of having a `version_check`: a genuine,
 * unaltered, cryptographically valid signature on an OLDER version of
 * a document that has since moved on is neither "authentic" (it no
 * longer matches what the document IS today) nor "tampered" (nothing
 * was forged) — it's SUPERSEDED.
 */
exports.up = (pgm) => {
  pgm.createTable('verification_records', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: {
      type: 'uuid',
      notNull: true,
      references: 'documents',
      onDelete: 'RESTRICT',
    },
    document_signature_id: {
      type: 'uuid',
      notNull: true,
      references: 'document_signatures',
      onDelete: 'RESTRICT',
    },
    verified_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    }, // null = external/public verifier
    hash_check: { type: 'boolean', notNull: true },
    signature_check: { type: 'boolean', notNull: true },
    ledger_check: { type: 'boolean', notNull: true },
    version_check: { type: 'boolean', notNull: true },
    overall_result: {
      type: 'varchar(16)',
      notNull: true,
      check: "overall_result IN ('AUTHENTIC','TAMPERED','SUPERSEDED')",
    },
    source: {
      type: 'varchar(16)',
      notNull: true,
      check: "source IN ('INTERNAL','EXTERNAL')",
    },
    ip_address: { type: 'varchar(64)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('verification_records', 'document_id');
  pgm.createIndex('verification_records', 'document_signature_id');
};

exports.down = (pgm) => {
  pgm.dropTable('verification_records');
};
