'use strict';

exports.shorthands = undefined;

/**
 * Police-hierarchy role system replacement: `departments.code` was
 * `varchar(32)`, sized for short handwritten codes like
 * 'STATE-HQ-ROOT'. Auto-generated unit codes (users.service.js's
 * inviteUser `newUnitName` path and createDepartment) combine the unit
 * type (up to 18 chars, e.g. ADMINISTRATION_IT) with a random suffix for
 * uniqueness, which doesn't fit in 32 — widened to comfortably fit both
 * that and any real-world human-chosen code.
 */
exports.up = (pgm) => {
  pgm.alterColumn('departments', 'code', { type: 'varchar(64)' });
};

exports.down = (pgm) => {
  pgm.alterColumn('departments', 'code', { type: 'varchar(32)' });
};
