'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  clearMocks: true,
  verbose: true,
  // The default 5000ms occasionally isn't enough for a beforeAll that
  // does several sequential scrypt password hashes (deliberately
  // expensive, N=16384 — that's the point of OWASP-recommended params)
  // plus HTTP round trips, especially under the CPU contention of many
  // suites (14+ and growing) running back to back with a real Postgres
  // in a container. The police-hierarchy role system (test/helpers/
  // create-user.js) makes this worse for deep roles — creating a
  // STATION-level user walks and creates an admin at every level from
  // STATE_HQ down, each hop its own invite+activate+login round trip.
  // Bumped again, generously, rather than chasing an intermittent flake
  // per-suite — a genuinely hung request still times out, just later.
  testTimeout: 30000,
  // Each test file builds its own app + pg.Pool; pg's internal
  // keepalive/retry timers can occasionally outlive pool.end() by a
  // beat when several suites run back to back in one worker. Test
  // results/exit code are unaffected — this just avoids relying on
  // Jest's default handle-detection grace period in CI.
  forceExit: true,
};
