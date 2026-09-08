'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://secure_dms:changeme_dev_only@localhost:5432/secure_dms_dev';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY || 'test-master-key';
process.env.STORAGE_ROOT_PATH = process.env.STORAGE_ROOT_PATH || '/tmp/secure-dms-test-storage';
process.env.BOOTSTRAP_ADMIN_USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
process.env.BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@secure-dms.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe_Bootstrap_123!';
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');

const app = buildApp();

afterAll(async () => {
  await pool.end();
});

function unique(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

async function createActivatedUser(adminToken, roleName) {
  const username = unique(roleName.toLowerCase());
  const email = `${username}@example.com`;
  const password = 'Str0ngP@ssw0rd!';

  const invite = await request(app)
    .post('/api/v1/users/invite')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username, email, roleName });
  const activate = await request(app)
    .post(`/api/v1/users/activate/${invite.body.activationToken}`)
    .send({ password, fullName: username });
  expect(activate.status).toBe(200);
  const login = await request(app).post('/api/v1/auth/login').send({ username, password });
  return { userId: login.body.user.id, accessToken: login.body.accessToken };
}

describe('audit module', () => {
  let adminToken;
  let investigatorA;
  let investigatorB;
  let ownCaseId;

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    adminToken = adminLogin.body.accessToken;

    investigatorA = await createActivatedUser(adminToken, 'INVESTIGATOR');
    investigatorB = await createActivatedUser(adminToken, 'INVESTIGATOR');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${investigatorA.accessToken}`)
      .send({ title: 'Audit Scope Test Case' });
    ownCaseId = created.body.id;
  });

  it('an ADMINISTRATOR can list audit events unrestricted', async () => {
    const res = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('an INVESTIGATOR only sees events for their own cases', async () => {
    const resA = await request(app)
      .get(`/api/v1/audit?resourceId=${ownCaseId}`)
      .set('Authorization', `Bearer ${investigatorA.accessToken}`);
    expect(resA.status).toBe(200);
    expect(resA.body.some((e) => e.case_id === ownCaseId)).toBe(true);

    // investigatorB is not a member of investigatorA's case, so filtering
    // for it must come back empty even though the events exist.
    const resB = await request(app)
      .get(`/api/v1/audit?resourceId=${ownCaseId}`)
      .set('Authorization', `Bearer ${investigatorB.accessToken}`);
    expect(resB.status).toBe(200);
    expect(resB.body.length).toBe(0);
  });

  it('a FORENSIC_OFFICER has no audit ledger access at all', async () => {
    const forensic = await createActivatedUser(adminToken, 'FORENSIC_OFFICER');
    const res = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${forensic.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /audit/verify confirms the chain is intact', async () => {
    const res = await request(app).get('/api/v1/audit/verify').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.intact).toBe(true);
    expect(res.body.brokenAtId).toBeNull();
    expect(res.body.totalEvents).toBeGreaterThan(0);
  });

  it('GET /audit/verify detects a broken chain if a row is tampered with', async () => {
    // Directly corrupt one historical row's event_hash, bypassing the
    // application entirely, then confirm verify catches it. audit_events
    // is shared, order-independent state across every test file in this
    // run, so the corruption is restored before the test ends — leaving
    // it broken would make any later file's own chain-coherency
    // assertions fail depending on Jest's file execution order.
    const { rows } = await pool.query('SELECT id, event_hash FROM audit_events ORDER BY id ASC LIMIT 1');
    const { id: targetId, event_hash: originalHash } = rows[0];

    try {
      await pool.query("UPDATE audit_events SET event_hash = 'deadbeef' WHERE id = $1", [targetId]);

      const res = await request(app).get('/api/v1/audit/verify').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.intact).toBe(false);
      expect(res.body.brokenAtId).toBe(targetId);
    } finally {
      await pool.query('UPDATE audit_events SET event_hash = $1 WHERE id = $2', [originalHash, targetId]);
    }
  });

  it('non-admin/auditor roles cannot verify or export the chain', async () => {
    const verifyRes = await request(app)
      .get('/api/v1/audit/verify')
      .set('Authorization', `Bearer ${investigatorA.accessToken}`);
    expect(verifyRes.status).toBe(403);

    const exportRes = await request(app)
      .get('/api/v1/audit/export')
      .set('Authorization', `Bearer ${investigatorA.accessToken}`);
    expect(exportRes.status).toBe(403);
  });

  it('GET /audit/export returns a CSV with a header row and data rows', async () => {
    const res = await request(app).get('/api/v1/audit/export').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      'id,created_at,actor_user_id,actor_username,action,resource_type,resource_id,case_id,result,ip_address,session_id,device,metadata,previous_hash,event_hash',
    );
    expect(lines.length).toBeGreaterThan(1);
  });
});
