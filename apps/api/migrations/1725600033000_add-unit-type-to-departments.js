'use strict';

exports.shorthands = undefined;

/**
 * Police-hierarchy role system replacement: `departments` already gives
 * us a parent-child tree (`parent_department_id`) — this just tags each
 * row with WHICH unit type it is (a District vs. a Station vs. an SRPF
 * Group), so the invite-authority logic in users.service.js can confirm
 * "this department row really is a STATION" before attaching a
 * STATION_ADMIN to it, and can walk the tree to enforce creation-scoping
 * (an admin may only create accounts within their own unit's subtree).
 *
 * Nullable — existing rows (there may be none, or dev/demo ones) aren't
 * backfilled; every row inserted from the role-replacement migration
 * onward sets it. Mirrors the level codes in
 * packages/shared/src/constants/roles.js's ROLE_LEVELS — keep in sync
 * manually.
 */
exports.up = (pgm) => {
  pgm.addColumn('departments', {
    unit_type: {
      type: 'varchar(32)',
      check: `unit_type IN (
        'STATE_HQ','WING','ADMINISTRATION_HQ','ADMINISTRATION_IT','RANGE','DISTRICT',
        'SP_OFFICE','SUBDIVISION','COMMISSIONERATE','BRANCH','SECTOR','ZONE','DIVISION',
        'STATION','CHOKI','SRPF','SRPF_GROUP','GRP','GRP_DIVISION','MARINE','MARINE_OUTPOST',
        'EXTERNAL_UNIT'
      )`,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('departments', 'unit_type');
};
