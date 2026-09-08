'use strict';

exports.shorthands = undefined;

/**
 * feature 12 — RSA-2048 signing keypairs (docs/architecture "Feature
 * flow · Document signing"). One row per generated/rotated keypair;
 * `private_key_envelope` is the PEM private key AES-256-GCM-encrypted
 * with the same master key + envelope format as document content
 * (services/crypto.encrypt) — there's no separate signing-key secret
 * this sprint, matching the Sprint 3 "single master key" decision.
 *
 * A user may rotate keys over time (old signatures made with a revoked
 * key must stay verifiable — see document_signatures.user_key_id — so
 * rows here are append-only, never deleted), but only one key may be
 * ACTIVE at once; enforced with a partial unique index rather than a
 * boolean-flip-and-hope-nothing-races approach.
 */
exports.up = (pgm) => {
  pgm.createTable('user_keys', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    public_key: { type: 'text', notNull: true }, // PEM, SPKI
    private_key_envelope: { type: 'bytea', notNull: true }, // AES-256-GCM envelope around the PEM PKCS8 private key
    key_id: { type: 'varchar(64)', notNull: true }, // which master key version encrypted the envelope (rotation seam)
    fingerprint: { type: 'char(64)', notNull: true }, // sha256(public_key PEM) — shown to identify which key signed something
    algorithm: { type: 'varchar(16)', notNull: true, default: 'RSA-2048' },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'ACTIVE',
      check: "status IN ('ACTIVE','REVOKED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
  });

  pgm.createIndex('user_keys', 'user_id');
  pgm.createIndex('user_keys', 'user_id', {
    unique: true,
    where: "status = 'ACTIVE'",
    name: 'user_keys_one_active_per_user',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('user_keys');
};
