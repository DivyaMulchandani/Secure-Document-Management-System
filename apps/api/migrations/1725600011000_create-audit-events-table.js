'use strict';

exports.shorthands = undefined;

/**
 * feature 9, 14, 18, 19 — the hash-chained, append-only audit ledger.
 * `id` is sequential (bigserial) because chain ordering depends on it.
 *
 * `case_id` is a plain column with NO foreign key yet — the `cases`
 * table doesn't exist until a later sprint.
 * TODO(cases-sprint): ALTER TABLE audit_events ADD CONSTRAINT
 *   audit_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES cases(id);
 */
exports.up = (pgm) => {
  pgm.createTable('audit_events', {
    id: { type: 'bigserial', primaryKey: true },
    actor_user_id: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    }, // null for system/anon
    action: { type: 'varchar(64)', notNull: true },
    resource_type: { type: 'varchar(64)', notNull: true },
    resource_id: { type: 'uuid' },
    case_id: { type: 'uuid' }, // see TODO above — no FK yet
    result: {
      type: 'varchar(8)',
      notNull: true,
      check: "result IN ('SUCCESS','FAILURE')",
    },
    ip_address: { type: 'varchar(64)' },
    session_id: { type: 'varchar(128)' },
    device: { type: 'varchar(255)' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    previous_hash: { type: 'char(64)' }, // null only for the very first row
    event_hash: { type: 'char(64)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('audit_events', 'actor_user_id');
  pgm.createIndex('audit_events', 'action');
};

exports.down = (pgm) => {
  pgm.dropTable('audit_events');
};
