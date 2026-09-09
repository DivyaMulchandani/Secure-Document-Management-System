'use strict';

exports.shorthands = undefined;

/**
 * Police-hierarchy role system replacement: rank (PSI/ASI/HC/Constable/
 * Jt.CP/Addl.CP/Internal Audit/...) is display-only free text, never
 * read by the permission engine — the role itself (e.g. STATION_OFFICER)
 * already determines what a user can do; rank just labels their actual
 * job title within that role. See packages/shared/src/constants/roles.js
 * for why ranks aren't distinct roles.
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    rank: { type: 'varchar(64)' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'rank');
};
