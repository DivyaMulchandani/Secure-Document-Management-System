'use strict';

exports.shorthands = undefined;

/**
 * Closes the TODO left in 1725600011000_create-audit-events-table.js:
 * the `cases` table exists now, so audit_events.case_id can finally get
 * its foreign key. ON DELETE SET NULL — losing a case (shouldn't happen
 * in practice; cases are archived, not deleted) must never take audit
 * history down with it.
 */
exports.up = (pgm) => {
  pgm.addConstraint('audit_events', 'audit_events_case_id_fkey', {
    foreignKeys: {
      columns: 'case_id',
      references: 'cases(id)',
      onDelete: 'SET NULL',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('audit_events', 'audit_events_case_id_fkey');
};
