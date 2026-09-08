'use strict';

exports.shorthands = undefined;

/**
 * Supporting table (not in the bare architecture ER list) backing
 * year-scoped sequential case numbers (CASE-<year>-<seq>). One row per
 * year; `last_sequence` is advanced with an atomic upsert
 * (INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING) in
 * cases.repository.js, so concurrent case creation never collides.
 */
exports.up = (pgm) => {
  pgm.createTable('case_number_counters', {
    year: { type: 'integer', primaryKey: true },
    last_sequence: { type: 'integer', notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('case_number_counters');
};
