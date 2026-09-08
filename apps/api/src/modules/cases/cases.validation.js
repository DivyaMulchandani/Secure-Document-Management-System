'use strict';

const { z } = require('zod');
const { CASE_STATUS_LIST, CASE_PRIORITY_LIST, CASE_ROLE_LIST } = require('@secure-dms/shared');

/**
 * Trivial schema for the stub health route (kept from Sprint 0).
 */
const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();

const createCaseBodySchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
  priority: z.enum(CASE_PRIORITY_LIST).optional(),
  departmentId: uuidSchema.optional(),
});

const caseIdParamsSchema = z.object({ id: uuidSchema });

const updateCaseBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(CASE_PRIORITY_LIST).optional(),
  departmentId: uuidSchema.optional(),
});

const updateCaseStatusBodySchema = z.object({
  status: z.enum(CASE_STATUS_LIST),
});

const listCasesQuerySchema = z.object({
  status: z.enum(CASE_STATUS_LIST).optional(),
  priority: z.enum(CASE_PRIORITY_LIST).optional(),
  departmentId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const addMemberBodySchema = z.object({
  userId: uuidSchema,
  caseRole: z.enum(CASE_ROLE_LIST),
});

const memberParamsSchema = z.object({ id: uuidSchema, userId: uuidSchema });

module.exports = {
  healthQuerySchema,
  createCaseBodySchema,
  caseIdParamsSchema,
  updateCaseBodySchema,
  updateCaseStatusBodySchema,
  listCasesQuerySchema,
  addMemberBodySchema,
  memberParamsSchema,
};
