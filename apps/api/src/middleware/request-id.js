'use strict';

const { v4: uuidv4 } = require('uuid');

const HEADER = 'x-request-id';

/**
 * Assigns req.id (reusing an inbound x-request-id header if present) and
 * echoes it back on the response, so every log line for a request —
 * including inside pino-http, mounted right after this — correlates.
 */
function requestId(req, res, next) {
  const incoming = req.headers[HEADER];
  req.id = (typeof incoming === 'string' && incoming.trim()) || uuidv4();
  res.setHeader(HEADER, req.id);
  next();
}

module.exports = requestId;
