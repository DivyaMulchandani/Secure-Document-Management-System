'use strict';

exports.shorthands = undefined;

/**
 * feature 20, 22 — monitored subset that raises alerts.
 *
 * `event_type` deliberately has NO CHECK constraint: the architecture's
 * full canonical list (MULTIPLE_FAILED_LOGIN, UNAUTH_ACCESS,
 * UNAUTH_DOWNLOAD, UNAUTH_MODIFY, INTEGRITY_FAILURE, INVALID_SIGNATURE,
 * CUSTODY_VIOLATION, UNAUTH_PERMISSION_CHANGE, EXPIRED_ACCESS_ATTEMPT,
 * LEDGER_FAILURE, SUSPICIOUS_ACTIVITY) isn't all raised until later
 * sprints; only MULTIPLE_FAILED_LOGIN is written this sprint.
 * TODO: add a CHECK constraint once the canonical list is finalized.
 */
exports.up = (pgm) => {
  pgm.createTable('security_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    event_type: { type: 'varchar(32)', notNull: true },
    severity: {
      type: 'varchar(16)',
      notNull: true,
      check: "severity IN ('LOW','MEDIUM','HIGH','CRITICAL')",
    },
    user_id: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    resource_type: { type: 'varchar(64)' },
    resource_id: { type: 'uuid' },
    description: { type: 'text' },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: 'OPEN',
      check: "status IN ('OPEN','ACKNOWLEDGED','RESOLVED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('security_events');
};
