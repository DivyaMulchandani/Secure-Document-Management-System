'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();

const documentIdParamsSchema = z.object({ documentId: uuidSchema });
const signatureIdParamsSchema = z.object({ id: uuidSchema });

const signBodySchema = z.object({ reason: z.string().max(2000).optional() });

const requestSignatureBodySchema = z.object({
  toUserId: uuidSchema,
  reason: z.string().max(2000).optional(),
});

const declineBodySchema = z.object({ reason: z.string().max(2000).optional() });

module.exports = {
  healthQuerySchema,
  documentIdParamsSchema,
  signatureIdParamsSchema,
  signBodySchema,
  requestSignatureBodySchema,
  declineBodySchema,
};
