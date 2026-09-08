'use strict';

exports.shorthands = undefined;

/**
 * feature 13 — Digital Chain of Custody. Its own tamper-evident hash
 * chain (previous_hash -> event_hash), scoped PER EVIDENCE ITEM — each
 * evidence's custody trail is its own chain, distinct from the global
 * audit_events ledger (services/custody-ledger, sibling to
 * services/ledger). Every custody-changing action also appends to the
 * global audit_events ledger separately (the golden path), so a
 * transfer produces BOTH a custody_events row and an audit_events row.
 *
 * `created_at` here (not the architecture prose's literal "timestamp")
 * for consistency with every other table's naming convention — a
 * deliberate, documented deviation, not an oversight.
 */
exports.up = (pgm) => {
  pgm.createTable('custody_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    evidence_id: {
      type: 'uuid',
      notNull: true,
      references: 'evidence',
      onDelete: 'CASCADE',
    },
    from_user_id: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    to_user_id: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    action: {
      type: 'varchar(24)',
      notNull: true,
      check: "action IN ('REGISTER','SEAL','TRANSFER_REQUEST','RECEIVE','ANALYZE','RETURN','ARCHIVE')",
    },
    reason: { type: 'text' },
    status: {
      type: 'varchar(16)',
      notNull: true,
      check: "status IN ('PENDING','ACKNOWLEDGED','COMPLETED','REJECTED')",
    },
    integrity_verified: { type: 'boolean', notNull: true, default: false },
    from_location: { type: 'varchar(255)' },
    to_location: { type: 'varchar(255)' },
    previous_hash: { type: 'char(64)' },
    event_hash: { type: 'char(64)', notNull: true },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('custody_events', 'evidence_id');
};

exports.down = (pgm) => {
  pgm.dropTable('custody_events');
};
