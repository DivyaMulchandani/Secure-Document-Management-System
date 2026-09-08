'use strict';

const { z } = require('zod');

const healthQuerySchema = z.object({}).strict();

const documentIdParamsSchema = z.object({ documentId: z.string().uuid() });

// The verification code is 24 lowercase hex chars (see
// signatures.service.js's generateVerificationCode) but this validates
// loosely (bounded length, no format assertion) so a malformed/garbage
// code from a public caller cleanly falls through to a 404 NOT_FOUND
// lookup miss rather than a 400 that leaks the expected code shape.
const codeParamsSchema = z.object({ code: z.string().min(1).max(24) });

module.exports = { healthQuerySchema, documentIdParamsSchema, codeParamsSchema };
