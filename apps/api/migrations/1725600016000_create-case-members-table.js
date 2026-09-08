'use strict';

exports.shorthands = undefined;

/**
 * feature 3 — case-level membership, the PRIMARY scoping mechanism for
 * who can see/act on anything inside a case (see services/permissions —
 * the "case scope" layer of the three-layer access check).
 *
 * A partial unique index (rather than a plain unique constraint) allows
 * a user to be re-added after being revoked, while still preventing two
 * simultaneously-active membership rows for the same (case, user) pair.
 */
exports.up = (pgm) => {
  pgm.createTable('case_members', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: {
      type: 'uuid',
      notNull: true,
      references: 'cases',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    case_role: {
      type: 'varchar(16)',
      notNull: true,
      check: "case_role IN ('OWNER','INVESTIGATOR','FORENSIC','PROSECUTOR','VIEWER')",
    },
    added_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' }, // null = active member
  });

  pgm.createIndex('case_members', ['case_id', 'user_id'], {
    unique: true,
    where: 'revoked_at IS NULL',
    name: 'case_members_active_unique',
  });
  pgm.createIndex('case_members', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('case_members');
};
