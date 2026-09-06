'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://invalid/invalid';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY || 'test-master-key';
process.env.STORAGE_ROOT_PATH = process.env.STORAGE_ROOT_PATH || '/tmp/secure-dms-test-storage';

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');

const app = buildApp();

afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  it('responds with a status field and a database check', async () => {
    const res = await request(app).get('/health');

    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('checks.database');
    expect(res.body).toHaveProperty('timestamp');
  });
});
