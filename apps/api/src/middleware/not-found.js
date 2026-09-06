'use strict';

function notFound(req, res) {
  res.status(404).json({
    error: { message: `No route for ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' },
  });
}

module.exports = notFound;
