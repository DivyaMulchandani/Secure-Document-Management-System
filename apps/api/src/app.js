'use strict';

const express = require('express');
const pinoHttp = require('pino-http');
const cookieParser = require('cookie-parser');

const logger = require('./logger');
const requestId = require('./middleware/request-id');
const securityHeaders = require('./middleware/security-headers');
const corsMiddleware = require('./middleware/cors');
const rateLimitMiddleware = require('./middleware/rate-limit');
const bodyLimits = require('./middleware/body-limits');
const authMiddleware = require('./middleware/auth');
const rbacStub = require('./middleware/rbac');
const notFound = require('./middleware/not-found');
const errorHandler = require('./middleware/error-handler');

const healthRoutes = require('./modules/health/health.routes');
const apiV1Routes = require('./routes');

/**
 * Builds and returns the Express app. Does NOT call listen() — that's
 * src/index.js's job, so this module stays importable from tests
 * (supertest) without binding a real port.
 *
 * Middleware chain order below matches the architecture's golden path
 * exactly. This is the literal implementation of Sprint 0's "done when":
 * a request must travel through every one of these steps to reach a
 * stub module endpoint.
 */
function buildApp() {
  const app = express();

  // 1. TLS — NOT implemented here. TLS terminates at a reverse proxy /
  // hosting load balancer in front of this process; Express always runs
  // plain HTTP behind that boundary. See README.md.

  // 2. Request id (needed before logging so log lines correlate)
  app.use(requestId);

  // 3. Structured request logging
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
    }),
  );

  // 4. Security headers (Helmet — also covers response hardening for
  // every later step, so no separate "sanitize output" middleware)
  app.use(securityHeaders);

  // 5. CORS
  app.use(corsMiddleware);

  // 6. Rate limiting
  app.use(rateLimitMiddleware);

  // 7. Body parsers with size limits
  app.use(...bodyLimits);

  // 7b. Cookie parsing (refresh_token) — must run before any controller
  // that reads req.cookies (auth/refresh, auth/logout).
  app.use(cookieParser());

  // 8. Auth — verifies a Bearer JWT if present, attaches req.user or
  // null. Never rejects on its own; see middleware/auth.js.
  app.use(authMiddleware);

  // 9. RBAC STUB globally — the full case/resource-scoped permission
  // engine (services/permissions.can()) is still future work. Route-level
  // require-role.js guards (Sprint 1) now partially satisfy this step
  // for simple RBAC-only checks (e.g. "must be ADMINISTRATOR").
  app.use(rbacStub);

  // 10. Route mounting
  // Top-level infra health-check — unauthenticated, no /api/v1 prefix,
  // still passes through steps 2-9 above.
  app.use('/health', healthRoutes);
  // 11. Per-route input validation happens inside each module's
  // <module>.routes.js (validation runs after auth/rbac, before the
  // controller) — not a global step, so it's not listed as its own
  // app.use() here.
  app.use('/api/v1', apiV1Routes);

  // 12. 404 catch-all
  app.use(notFound);

  // 13. Centralized error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = buildApp;
