'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://invalid/invalid';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.ENCRYPTION_MASTER_KEY = 'test-master-key';
process.env.STORAGE_ROOT_PATH = '/tmp/secure-dms-test-storage';
// Isolated in its own file/app instance with a deliberately low max so
// it doesn't interfere with (or get exhausted by) the assertions in
// middleware-chain.test.js.
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '3';

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');

const app = buildApp();

afterAll(async () => {
  await pool.end();
});

describe('rate limiting', () => {
  it('returns 429 after exceeding RATE_LIMIT_MAX requests in the window', async () => {
    const max = Number(process.env.RATE_LIMIT_MAX);
    let lastStatus;

    for (let i = 0; i < max + 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/api/v1/permissions/health');
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
