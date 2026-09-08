'use strict';

const { z } = require('zod');
const { PERMISSION_LIST } = require('@secure-dms/shared');

const healthQuerySchema = z.object({}).strict();

const RESOURCE_TYPES = ['CASE', 'DOCUMENT', 'EVIDENCE', 'REPORT'];
const uuidSchema = z.string().uuid();

const grantBodySchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: uuidSchema,
  userId: uuidSchema,
  permissionCode: z.enum(PERMISSION_LIST),
  expiresAt: z.string().datetime().optional(),
});

const listGrantsQuerySchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: uuidSchema,
});

const grantIdParamsSchema = z.object({ id: uuidSchema });

module.exports = { healthQuerySchema, grantBodySchema, listGrantsQuerySchema, grantIdParamsSchema };
