'use strict';

exports.shorthands = undefined;

/**
 * feature 12 — RSA-SHA256 signatures bound to a document VERSION's hash
 * (docs/architecture "Feature flow · Document signing"). Doubles as the
 * "pending-signature queue" model: a row is created PENDING when one
 * user requests another's signature (requested_by set, signer/hash/
 * signature columns null), or created straight to SIGNED for a
 * self-initiated signature (requested_by null). Rows are never deleted
 * or overwritten in place — a decline or a stale/superseded request
 * just changes `status`; the historical record stays.
 *
 * `document_version_id` is captured at request-or-sign time and never
 * changes afterward — this IS the "bound to a version hash" binding;
 * `signed_hash` is a frozen copy of that version's sha256_hash at the
 * moment of signing (belt-and-suspenders ground truth for verification,
 * independent of whatever document_versions.sha256_hash reads later).
 */
exports.up = (pgm) => {
  pgm.createTable('document_signatures', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: {
      type: 'uuid',
      notNull: true,
      references: 'documents',
      onDelete: 'RESTRICT',
    },
    document_version_id: {
      type: 'uuid',
      notNull: true,
      references: 'document_versions',
      onDelete: 'RESTRICT',
    },
    signer_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    requested_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','SIGNED','DECLINED')",
    },
    reason: { type: 'text' }, // why the signature was requested / the signer's stated purpose
    decline_reason: { type: 'text' },
    user_key_id: {
      type: 'uuid',
      references: 'user_keys',
      onDelete: 'RESTRICT',
    },
    signed_hash: { type: 'char(64)' }, // frozen document_version.sha256_hash at signing time
    signature: { type: 'text' }, // base64 RSA-SHA256 signature over signed_hash
    verification_code: { type: 'varchar(24)', unique: true }, // the external-verifier portal's public lookup key
    signed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('document_signatures', 'document_id');
  pgm.createIndex('document_signatures', 'document_version_id');
  pgm.createIndex('document_signatures', 'signer_id');
  // Backs the pending-signature queue query (WHERE signer_id = me AND status = 'PENDING').
  pgm.createIndex('document_signatures', ['signer_id', 'status']);
};

exports.down = (pgm) => {
  pgm.dropTable('document_signatures');
};
