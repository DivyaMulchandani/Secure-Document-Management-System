'use strict';

const { httpError } = require('../errors');

/**
 * Wires a zod schema to a route. Applied per-route in each module's
 * <module>.routes.js, after auth/rbac, before the controller — matching
 * the ordering documented in every <module>.validation.js header
 * comment since Sprint 0. Replaces req.body/params/query with the
 * *parsed* (and thus coerced/defaulted) value so controllers can trust
 * the shape.
 *
 * @param {{body?: import('zod').ZodType, params?: import('zod').ZodType, query?: import('zod').ZodType}} schemas
 */
function validate({ body, params, query } = {}) {
  return (req, res, next) => {
    try {
      if (body) req.body = body.parse(req.body);
      if (params) req.params = params.parse(req.params);
      if (query) req.query = query.parse(req.query);
      next();
    } catch (err) {
      const message = err.errors ? err.errors.map((e) => e.message).join('; ') : err.message;
      next(httpError(400, 'VALIDATION_ERROR', message));
    }
  };
}

module.exports = validate;
