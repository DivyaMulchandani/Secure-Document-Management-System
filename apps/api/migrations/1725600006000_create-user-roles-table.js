'use strict';

exports.shorthands = undefined;

/**
 * Pure join table — "a user may hold several" roles
 * (docs/architecture — "Domain · Identity & access").
 */
exports.up = (pgm) => {
  pgm.createTable(
    'user_roles',
    {
      user_id: {
        type: 'uuid',
        notNull: true,
        references: 'users',
        onDelete: 'CASCADE',
      },
      role_id: {
        type: 'uuid',
        notNull: true,
        references: 'roles',
        onDelete: 'CASCADE',
      },
    },
    {
      constraints: {
        primaryKey: ['user_id', 'role_id'],
      },
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('user_roles');
};
