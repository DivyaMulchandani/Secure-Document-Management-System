'use strict';

const { z } = require('zod');
const { ROLE_LIST } = require('@secure-dms/shared');

/**
 * Trivial schema for the stub health route (kept from Sprint 0).
 */
const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.');

const inviteBodySchema = z.object({
  username: z.string().min(3).max(64),
  email: z.string().email(),
  roleName: z.enum(ROLE_LIST),
  departmentId: uuidSchema.optional(),
});

const activateParamsSchema = z.object({ token: z.string().min(1) });

const activateBodySchema = z.object({
  password: passwordSchema,
  fullName: z.string().min(1).max(160),
});

const listUsersQuerySchema = z.object({
  status: z.enum(['INVITED', 'ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
  departmentId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const userIdParamsSchema = z.object({ id: uuidSchema });

const updateStatusBodySchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
});

const updateRolesBodySchema = z.object({
  roleNames: z.array(z.enum(ROLE_LIST)).min(1),
});

const createDepartmentBodySchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(32),
  parentDepartmentId: uuidSchema.optional(),
});

module.exports = {
  healthQuerySchema,
  inviteBodySchema,
  activateParamsSchema,
  activateBodySchema,
  listUsersQuerySchema,
  userIdParamsSchema,
  updateStatusBodySchema,
  updateRolesBodySchema,
  createDepartmentBodySchema,
};
