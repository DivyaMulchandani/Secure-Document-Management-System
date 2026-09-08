'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();

const registerEvidenceBodySchema = z.object({
  caseId: uuidSchema,
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
  category: z.string().max(100).optional(),
  location: z.string().max(255).optional(),
});

const evidenceIdParamsSchema = z.object({ id: uuidSchema });

const listEvidenceQuerySchema = z.object({
  caseId: uuidSchema,
  status: z
    .enum([
      'REGISTERED',
      'SEALED',
      'VERIFIED',
      'IN_CUSTODY',
      'IN_TRANSIT',
      'RECEIVED',
      'UNDER_ANALYSIS',
      'RETURNED',
      'ARCHIVED',
    ])
    .optional(),
});

const requestTransferBodySchema = z.object({
  toUserId: uuidSchema,
  reason: z.string().max(2000).optional(),
  toLocation: z.string().max(255).optional(),
});

const transferParamsSchema = z.object({ id: uuidSchema, transferId: uuidSchema });

const rejectTransferBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

const artifactParamsSchema = z.object({ id: uuidSchema, artifactId: uuidSchema });

module.exports = {
  healthQuerySchema,
  registerEvidenceBodySchema,
  evidenceIdParamsSchema,
  listEvidenceQuerySchema,
  requestTransferBodySchema,
  transferParamsSchema,
  rejectTransferBodySchema,
  artifactParamsSchema,
};
