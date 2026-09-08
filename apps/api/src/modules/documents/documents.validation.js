'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const uuidSchema = z.string().uuid();

// multipart/form-data fields always arrive as strings (multer), so these
// intentionally don't use z.coerce — there's nothing to coerce FROM.
const createDocumentBodySchema = z.object({
  caseId: uuidSchema,
  documentTypeId: uuidSchema.optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
});

const newVersionBodySchema = z.object({
  changeNote: z.string().max(2000).optional(),
});

const documentIdParamsSchema = z.object({ id: uuidSchema });
const versionParamsSchema = z.object({ id: uuidSchema, versionId: uuidSchema });

const updateDocumentBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).optional(),
  documentTypeId: uuidSchema.optional(),
});

const listDocumentsQuerySchema = z.object({
  caseId: uuidSchema,
  status: z.enum(['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'APPROVED', 'SIGNED', 'FINAL', 'ARCHIVED', 'DELETED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const addCommentBodySchema = z.object({
  body: z.string().min(1).max(10000),
});

module.exports = {
  healthQuerySchema,
  createDocumentBodySchema,
  newVersionBodySchema,
  documentIdParamsSchema,
  versionParamsSchema,
  updateDocumentBodySchema,
  listDocumentsQuerySchema,
  addCommentBodySchema,
};
