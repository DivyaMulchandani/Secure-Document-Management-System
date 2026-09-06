'use strict';

const helmet = require('helmet');

/**
 * Helmet sets its hardening headers on every response regardless of
 * where else in the chain later middleware runs, so this single
 * mount point also covers the architecture's "output security
 * headers / sanitize" step — no separate step needed.
 */
module.exports = helmet();
