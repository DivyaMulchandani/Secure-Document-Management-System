'use strict';

const config = require('../config');

/**
 * Centralized Express error handler — must be mounted last (4-arg
 * signature is what makes Express treat it as an error handler).
 * Never leaks stack traces once NODE_ENV=production.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status >= 500 ? 'Internal server error' : err.message || 'Request failed';

  if (req.log) {
    req.log.error({ err, status, code }, 'request failed');
  }

  const body = { error: { message, code } };
  if (config.server.nodeEnv !== 'production' && err.stack) {
    body.error.stack = err.stack;
  }

  res.status(status).json(body);
}

module.exports = errorHandler;
