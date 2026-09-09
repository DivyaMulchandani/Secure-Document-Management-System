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
// Fewer attempts needed in tests than the production default of 5.
process.env.AUTH_LOCKOUT_THRESHOLD = '3';
// This file makes many requests (invite/activate/lockout/refresh/MFA) —
// set explicitly high rather than relying on whatever another test file
// left in process.env (env vars persist across files in one --runInBand
// worker process).
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const request = require('supertest');
const { authenticator } = require('otplib');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');

const app = buildApp();

afterAll(async () => {
  await pool.end();
});

describe('auth module — this IS the literal "done when" scenario', () => {
  let adminAccessToken;
  let throwawayUser; // { username, password }

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    expect(adminLogin.status).toBe(200);
    adminAccessToken = adminLogin.body.accessToken;

    // Invite -> activate a throwaway user via the real API, for the
    // login/lockout scenarios below.
    const suffix = Date.now();
    const inviteRes = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        username: `throwaway_${suffix}`,
        email: `throwaway_${suffix}@example.com`,
        roleName: 'STATE_HQ_OFFICER',
      });
    expect(inviteRes.status).toBe(200);
    expect(inviteRes.body.activationToken).toBeTruthy();

    const password = 'Str0ngP@ssw0rd!';
    const activateRes = await request(app)
      .post(`/api/v1/users/activate/${inviteRes.body.activationToken}`)
      .send({ password, fullName: 'Throwaway User' });
    expect(activateRes.status).toBe(200);

    throwawayUser = { username: `throwaway_${suffix}`, password };
  });

  it('logs in the bootstrap admin with correct credentials and sets the refresh cookie', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.roles).toContain('STATE_HQ_ADMIN');
    const cookies = [].concat(res.headers['set-cookie'] || []);
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('rejects a wrong password without revealing which factor failed', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: 'definitely-wrong',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown username the same way (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'does-not-exist', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after AUTH_LOCKOUT_THRESHOLD consecutive bad passwords, with a security_events row and a chained audit_events trail', async () => {
    const threshold = Number(process.env.AUTH_LOCKOUT_THRESHOLD);
    let lastRes;
    for (let i = 0; i < threshold; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      lastRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: throwawayUser.username, password: 'wrong-password' });
    }
    expect(lastRes.status).toBe(403);
    expect(lastRes.body.error.code).toBe('ACCOUNT_LOCKED');

    const { rows: secEvents } = await pool.query(
      `SELECT se.* FROM security_events se
       JOIN users u ON u.id = se.user_id
       WHERE u.username = $1 AND se.event_type = 'MULTIPLE_FAILED_LOGIN'`,
      [throwawayUser.username],
    );
    expect(secEvents.length).toBeGreaterThanOrEqual(1);

    const { rows: auditEvents } = await pool.query(
      `SELECT ae.* FROM audit_events ae
       JOIN users u ON u.id = ae.actor_user_id
       WHERE u.username = $1 AND ae.action = 'LOGIN_FAILED'
       ORDER BY ae.id`,
      [throwawayUser.username],
    );
    expect(auditEvents.length).toBeGreaterThanOrEqual(threshold);

    // The hash chain is internally consistent: each row's previous_hash
    // equals the prior row's event_hash (checked across the whole
    // ledger, not just these rows, since the chain is global).
    const { rows: allEvents } = await pool.query('SELECT id, previous_hash, event_hash FROM audit_events ORDER BY id');
    for (let i = 1; i < allEvents.length; i += 1) {
      expect(allEvents[i].previous_hash).toBe(allEvents[i - 1].event_hash);
    }
  });

  it('an admin can unlock the account, which also resets the failed-login count', async () => {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [
      throwawayUser.username,
    ]);
    const userId = rows[0].id;

    const patchRes = await request(app)
      .patch(`/api/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'ACTIVE' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('ACTIVE');

    const { rows: refreshed } = await pool.query(
      'SELECT failed_login_count FROM users WHERE id = $1',
      [userId],
    );
    expect(refreshed[0].failed_login_count).toBe(0);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: throwawayUser.username, password: throwawayUser.password });
    expect(loginRes.status).toBe(200);
  });

  it('GET /auth/me requires authentication', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the authenticated identity', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(process.env.BOOTSTRAP_ADMIN_USERNAME);
    expect(res.body.roles).toContain('STATE_HQ_ADMIN');
  });

  it('refreshes the access token using the httpOnly cookie', async () => {
    const agent = request.agent(app);
    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ username: throwawayUser.username, password: throwawayUser.password });
    expect(loginRes.status).toBe(200);

    const refreshRes = await agent.post('/api/v1/auth/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
  });

  it('logs out and then rejects a refresh with the revoked cookie', async () => {
    const agent = request.agent(app);
    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ username: throwawayUser.username, password: throwawayUser.password });
    expect(loginRes.status).toBe(200);

    const logoutRes = await agent
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(logoutRes.status).toBe(200);

    const refreshRes = await agent.post('/api/v1/auth/refresh');
    expect(refreshRes.status).toBe(401);
  });

  it('MFA round trip: enroll, verify, then the login requires the OTP', async () => {
    const agent = request.agent(app);
    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ username: throwawayUser.username, password: throwawayUser.password });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.accessToken;

    const enrollRes = await agent.post('/api/v1/auth/mfa/enroll').set('Authorization', `Bearer ${token}`);
    expect(enrollRes.status).toBe(200);
    expect(enrollRes.body.secret).toBeTruthy();
    expect(enrollRes.body.qrCodeDataUrl).toMatch(/^data:image\/png/);

    const verifyRes = await agent
      .post('/api/v1/auth/mfa/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ otp: authenticator.generate(enrollRes.body.secret) });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.mfaEnabled).toBe(true);

    const loginWithoutOtp = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: throwawayUser.username, password: throwawayUser.password });
    expect(loginWithoutOtp.status).toBe(401);

    const loginWithOtp = await request(app).post('/api/v1/auth/login').send({
      username: throwawayUser.username,
      password: throwawayUser.password,
      otp: authenticator.generate(enrollRes.body.secret),
    });
    expect(loginWithOtp.status).toBe(200);
  });
});
