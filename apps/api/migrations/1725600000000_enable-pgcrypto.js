'use strict';

exports.shorthands = undefined;

/**
 * Needed for gen_random_uuid(), used as the default on every uuid
 * primary key across the schema (this sprint and every future one).
 */
exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });
};

exports.down = (pgm) => {
  pgm.dropExtension('pgcrypto', { ifExists: true });
};
