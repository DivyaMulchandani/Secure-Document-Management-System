'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const listEventsQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  action: z.string().max(64).optional(),
  resourceType: z.string().max(64).optional(),
  resourceId: z.string().uuid().optional(),
  result: z.enum(['SUCCESS', 'FAILURE']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

module.exports = { healthQuerySchema, listEventsQuerySchema };
