'use strict';

const pino = require('pino');
const config = require('../config');

/**
 * Base structured logger. Prefer `req.log` (attached by pino-http, see
 * middleware wiring in app.js) inside request handlers so log lines
 * correlate via request id — import this base logger only for
 * startup/shutdown/background logging outside a request lifecycle.
 */
const logger = pino({
  level: config.log.level,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    remove: true,
  },
});

module.exports = logger;
