'use strict';

const { z } = require('zod');

/**
 * Trivial schema for the stub health route (kept from Sprint 0).
 */
const healthQuerySchema = z.object({}).strict();

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  otp: z
    .string()
    .regex(/^\d{6}$/, 'OTP must be a 6-digit code.')
    .optional(),
});

const mfaVerifyBodySchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code.'),
});

module.exports = { healthQuerySchema, loginBodySchema, mfaVerifyBodySchema };
