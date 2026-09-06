'use strict';

exports.shorthands = undefined;

/**
 * Seed values mirror packages/shared/src/constants/document-types.js —
 * keep the two in sync manually (docs/architecture — "Domain ·
 * Documents & AI enrichment").
 */
exports.up = (pgm) => {
  pgm.createTable('document_types', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'varchar(40)', notNull: true, unique: true },
    name: { type: 'varchar(160)', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    INSERT INTO document_types (code, name) VALUES
      ('FIR', 'First Information Report'),
      ('WITNESS_STATEMENT', 'Witness Statement'),
      ('INVESTIGATION_REPORT', 'Investigation Report'),
      ('CHARGE_SHEET', 'Charge Sheet'),
      ('COURT_FILING', 'Court Filing'),
      ('FORENSIC_REPORT', 'Forensic Report'),
      ('EVIDENCE_RECORD', 'Evidence Record'),
      ('LEGAL_NOTICE', 'Legal Notice'),
      ('JUDGMENT_ORDER', 'Judgment / Order')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM document_types
    WHERE code IN (
      'FIR', 'WITNESS_STATEMENT', 'INVESTIGATION_REPORT', 'CHARGE_SHEET', 'COURT_FILING',
      'FORENSIC_REPORT', 'EVIDENCE_RECORD', 'LEGAL_NOTICE', 'JUDGMENT_ORDER'
    );
  `);
  pgm.dropTable('document_types');
};
