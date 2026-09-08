'use strict';

exports.shorthands = undefined;

/**
 * feature 16 — annotations on a document (case-scoped via the parent
 * document, gated by the COMMENT permission code through the same
 * three-layer engine as everything else).
 */
exports.up = (pgm) => {
  pgm.createTable('document_comments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: {
      type: 'uuid',
      notNull: true,
      references: 'documents',
      onDelete: 'CASCADE',
    },
    author_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('document_comments', 'document_id');
};

exports.down = (pgm) => {
  pgm.dropTable('document_comments');
};
