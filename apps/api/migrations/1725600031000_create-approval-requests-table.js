'use strict';

exports.shorthands = undefined;

/**
 * feature 16 — the draft -> review -> approve/reject/revise -> sign ->
 * final workflow. One row per "this document version was submitted for
 * approval" — `document_version_id` is frozen at submission time, same
 * "bound to a version" pattern as document_signatures (Sprint 5): a new
 * version uploaded mid-review doesn't retroactively change what's being
 * reviewed, it would need a fresh request.
 *
 * `current_step` (0-based) points into this request's ordered
 * approval_steps — the chain is sequential, not parallel: step N+1
 * can't act until step N has approved. `status` is the chain's overall
 * outcome, driven by its steps (approval.service.js keeps the two in
 * sync in the same transaction, never left for a client to infer).
 */
exports.up = (pgm) => {
  pgm.createTable('approval_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: {
      type: 'uuid',
      notNull: true,
      references: 'documents',
      onDelete: 'RESTRICT',
    },
    document_version_id: {
      type: 'uuid',
      notNull: true,
      references: 'document_versions',
      onDelete: 'RESTRICT',
    },
    requested_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','APPROVED','REJECTED','REVISION_REQUESTED')",
    },
    current_step: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });

  pgm.createIndex('approval_requests', 'document_id');
};

exports.down = (pgm) => {
  pgm.dropTable('approval_requests');
};
