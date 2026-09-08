'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();

const documentIdParamsSchema = z.object({ documentId: uuidSchema });
const stepIdParamsSchema = z.object({ stepId: uuidSchema });

const submitBodySchema = z.object({
  approverIds: z.array(uuidSchema).min(1).max(10),
});

const decideBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'REVISION_REQUESTED']),
  comments: z.string().max(2000).optional(),
});

module.exports = {
  healthQuerySchema,
  documentIdParamsSchema,
  stepIdParamsSchema,
  submitBodySchema,
  decideBodySchema,
};
