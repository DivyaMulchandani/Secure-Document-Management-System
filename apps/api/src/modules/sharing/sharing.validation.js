'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();

const documentIdParamsSchema = z.object({ documentId: uuidSchema });
const shareParamsSchema = z.object({ documentId: uuidSchema, shareId: uuidSchema });

const createShareBodySchema = z.object({
  toUserId: uuidSchema,
  permission: z.enum(['VIEW', 'DOWNLOAD']).optional(),
  expiresInHours: z.coerce.number().int().min(1).max(720).optional(), // up to 30 days
  reason: z.string().max(2000).optional(),
});

module.exports = { healthQuerySchema, documentIdParamsSchema, shareParamsSchema, createShareBodySchema };
