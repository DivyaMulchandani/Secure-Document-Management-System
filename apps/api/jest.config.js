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
  // in a container. Bumped once, generously, rather than chasing an
  // intermittent flake per-suite — a genuinely hung request still times
  // out, just at 15s instead of 5s.
  testTimeout: 15000,
  // Each test file builds its own app + pg.Pool; pg's internal
  // keepalive/retry timers can occasionally outlive pool.end() by a
  // beat when several suites run back to back in one worker. Test
  // results/exit code are unaffected — this just avoids relying on
  // Jest's default handle-detection grace period in CI.
  forceExit: true,
};
