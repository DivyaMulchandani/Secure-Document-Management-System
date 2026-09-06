'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://invalid/invalid';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.ENCRYPTION_MASTER_KEY = 'test-master-key';
process.env.STORAGE_ROOT_PATH = '/tmp/secure-dms-test-storage';
process.env.BODY_LIMIT = '200b';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
// High on purpose — rate-limiting itself is covered in its own isolated
// test file (rate-limit.test.js) with a deliberately low max. Keeping
// this file's limit high stops it from tripping across these unrelated
// assertions, which all share one rate-limit bucket per test run.
process.env.RATE_LIMIT_MAX = '1000';

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');

const app = buildApp();

afterAll(async () => {
  await pool.end();
});

describe('middleware chain — request reaches a stub module endpoint end to end', () => {
  it('GET /api/v1/audit/health returns the stub module payload', async () => {
    const res = await request(app).get('/api/v1/audit/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ module: 'audit', status: 'ok' });
  });

  it('carries Helmet security headers on the response', async () => {
    const res = await request(app).get('/api/v1/audit/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('echoes a request id header', async () => {
    const res = await request(app).get('/api/v1/audit/health');

    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reuses an inbound x-request-id header instead of generating a new one', async () => {
    const res = await request(app)
      .get('/api/v1/audit/health')
      .set('x-request-id', 'test-fixed-request-id');

    expect(res.headers['x-request-id']).toBe('test-fixed-request-id');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error.code', 'NOT_FOUND');
  });

  it('rejects an oversized request body with 413', async () => {
    const oversized = { data: 'x'.repeat(1000) };

    const res = await request(app).post('/api/v1/audit/health').send(oversized);

    expect(res.status).toBe(413);
  });
});
