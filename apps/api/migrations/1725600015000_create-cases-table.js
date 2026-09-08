'use strict';

exports.shorthands = undefined;

/**
 * feature 3 — case management. The organising spine every document/
 * evidence record will hang off in later sprints.
 */
exports.up = (pgm) => {
  pgm.createTable('cases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_number: { type: 'varchar(40)', notNull: true, unique: true },
    title: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    status: {
      type: 'varchar(24)',
      notNull: true,
      default: 'OPEN',
      check:
        "status IN ('OPEN','UNDER_INVESTIGATION','UNDER_REVIEW','SUBMITTED','CLOSED','ARCHIVED')",
    },
    priority: {
      type: 'varchar(16)',
      notNull: true,
      default: 'MEDIUM',
      check: "priority IN ('LOW','MEDIUM','HIGH','CRITICAL')",
    },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    department_id: {
      type: 'uuid',
      references: 'departments',
      onDelete: 'SET NULL',
    },
    opened_at: { type: 'timestamptz' },
    closed_at: { type: 'timestamptz' },
    archived_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('cases', 'status');
  pgm.createIndex('cases', 'owner_id');
};

exports.down = (pgm) => {
  pgm.dropTable('cases');
};
