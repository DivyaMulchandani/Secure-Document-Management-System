'use strict';

exports.shorthands = undefined;

/**
 * Per-case counter backing evidence_number generation (e.g.
 * "EV-2026-0007-01" for the 1st evidence item registered against case
 * "CASE-2026-0007") — same race-safe upsert pattern as
 * case_number_counters (1725600014000).
 */
exports.up = (pgm) => {
  pgm.createTable('evidence_counters', {
    case_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'cases',
      onDelete: 'CASCADE',
    },
    last_sequence: { type: 'integer', notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('evidence_counters');
};
