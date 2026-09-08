'use strict';

exports.shorthands = undefined;

/**
 * Closes the mutual-FK ordering problem noted in
 * 1725600019000_create-documents-table.js: document_versions now
 * exists, so documents.current_version_id can finally get its FK.
 * ON DELETE SET NULL — a version row should never be hard-deleted in
 * practice (versions are immutable/append-only), but if it ever were,
 * losing the pointer must never cascade into losing the document.
 */
exports.up = (pgm) => {
  pgm.addConstraint('documents', 'documents_current_version_id_fkey', {
    foreignKeys: {
      columns: 'current_version_id',
      references: 'document_versions(id)',
      onDelete: 'SET NULL',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('documents', 'documents_current_version_id_fkey');
};
