'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  clearMocks: true,
  verbose: true,
  // Each test file builds its own app + pg.Pool; pg's internal
  // keepalive/retry timers can occasionally outlive pool.end() by a
  // beat when several suites run back to back in one worker. Test
  // results/exit code are unaffected — this just avoids relying on
  // Jest's default handle-detection grace period in CI.
  forceExit: true,
};
