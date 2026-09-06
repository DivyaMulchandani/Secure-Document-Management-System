'use strict';

const { checkConnection } = require('../../db/pool');
const pkg = require('../../../package.json');

/**
 * GET /health — infra-facing liveness/readiness probe. Unauthenticated
 * by design (orchestrators/load balancers hit this without a token) but
 * still passes through the full generic middleware shell (Helmet, CORS,
 * rate limit, body limits, request-id, logging) — only the auth/rbac
 * stubs explicitly allowlist this path.
 */
async function getHealth(req, res) {
  const checks = {};
  let ok = true;

  try {
    await checkConnection();
    checks.database = 'ok';
  } catch (err) {
    ok = false;
    checks.database = 'error';
    checks.databaseError = err.message;
  }

  const body = {
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
    version: pkg.version,
  };

  res.status(ok ? 200 : 503).json(body);
}

module.exports = { getHealth };
