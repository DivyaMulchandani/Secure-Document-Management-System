'use strict';

const { z } = require('zod');
const { ROLE_LIST, LEVEL_CODES } = require('@secure-dms/shared');

/**
 * Trivial schema for the stub health route (kept from Sprint 0).
 */
const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.');

const lookupQuerySchema = z.object({ q: z.string().min(1).max(64) });

const inviteBodySchema = z.object({
  username: z.string().min(3).max(64),
  email: z.string().email(),
  roleName: z.enum(ROLE_LIST),
  departmentId: uuidSchema.optional(),
  // Alternative to departmentId when inviting a new child _ADMIN into a
  // unit that doesn't exist yet — creates it inline, as a child of the
  // inviter's own department. See users.service.js#assertCreationAuthority.
  newUnitName: z.string().min(1).max(160).optional(),
  // Free-text job title (PSI/ASI/HC/Constable/Jt.CP/Internal Audit/...) —
  // display-only, never read by the permission engine.
  rank: z.string().min(1).max(64).optional(),
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

// code/parentDepartmentId are no longer client-supplied — the service
// always generates a unique code and forces the parent to the actor's
// own department (see users.service.js#createDepartment); the client
// only says what kind of unit and what to call it.
const createDepartmentBodySchema = z.object({
  name: z.string().min(1).max(160),
  unitType: z.enum(LEVEL_CODES),
});

module.exports = {
  healthQuerySchema,
  lookupQuerySchema,
  inviteBodySchema,
  activateParamsSchema,
  activateBodySchema,
  listUsersQuerySchema,
  userIdParamsSchema,
  updateStatusBodySchema,
  updateRolesBodySchema,
  createDepartmentBodySchema,
};
