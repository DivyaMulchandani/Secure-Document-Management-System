'use strict';

exports.shorthands = undefined;

/**
 * One row per named approver in an approval_requests chain, in
 * `step_order`. Only the step matching its request's `current_step` is
 * actionable — approval.service.js enforces "not your turn yet" for
 * anyone else, the same resource-instance-authorization shape as
 * evidence's transfer accept/reject and signatures' pending-queue
 * fulfil/decline (requireAuth-only route, checked inline in the
 * service, since "is this the approver whose turn it currently is" is a
 * data-dependent check the generic case-role engine can't express).
 */
exports.up = (pgm) => {
  pgm.createTable('approval_steps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    approval_request_id: {
      type: 'uuid',
      notNull: true,
      references: 'approval_requests',
      onDelete: 'CASCADE',
    },
    step_order: { type: 'integer', notNull: true },
    approver_id: {
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
    comments: { type: 'text' },
    decided_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('approval_steps', 'approval_request_id');
  pgm.createIndex('approval_steps', 'approver_id');
  pgm.addConstraint('approval_steps', 'approval_steps_request_step_unique', {
    unique: ['approval_request_id', 'step_order'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('approval_steps');
};
