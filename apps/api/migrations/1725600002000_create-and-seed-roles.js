'use strict';

exports.shorthands = undefined;

/**
 * Seed values mirror packages/shared/src/constants/roles.js — keep the
 * two in sync manually (docs/architecture — "Actors & roles").
 */
exports.up = (pgm) => {
  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'varchar(64)', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    INSERT INTO roles (name, description) VALUES
      ('ADMINISTRATOR', 'Manages users, roles, departments, security posture, retention, backups, and assets.'),
      ('INVESTIGATOR', 'Primary case worker: owns/drives cases, uploads documents, registers/moves evidence.'),
      ('FORENSIC_OFFICER', 'Receives evidence, verifies integrity, analyses it, produces signed forensic reports.'),
      ('PROSECUTOR', 'Reviews and approves shared documents for legal action; verifies authenticity.'),
      ('AUDITOR', 'Read-only oversight of the audit ledger and security events; least-privilege role.')
    ON CONFLICT (name) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM roles
    WHERE name IN ('ADMINISTRATOR', 'INVESTIGATOR', 'FORENSIC_OFFICER', 'PROSECUTOR', 'AUDITOR');
  `);
  pgm.dropTable('roles');
};
