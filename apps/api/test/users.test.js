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

function uniqueUser(prefix) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  return { username: `${prefix}_${suffix}`, email: `${prefix}_${suffix}@example.com` };
}

describe('users module', () => {
  let adminAccessToken;

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    expect(adminLogin.status).toBe(200);
    adminAccessToken = adminLogin.body.accessToken;
  });

  it('lets an admin invite a user and returns a dev-mode activation token', async () => {
    const { username, email } = uniqueUser('invitee');
    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ username, email, roleName: 'STATE_HQ_OFFICER' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INVITED');
    expect(res.body.activationToken).toBeTruthy();
    expect(res.body.activationUrl).toContain(res.body.activationToken);
  });

  it('forbids inviting as a role with no creation authority (e.g. a fresh officer)', async () => {
    // Create + activate a non-admin (_OFFICER) user first — createsRolesFor
    // an _OFFICER role is always empty, so it can never invite anyone.
    const { username, email } = uniqueUser('nonadmin');
    const invite = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ username, email, roleName: 'STATE_HQ_OFFICER' });
    const password = 'Str0ngP@ssw0rd!';
    await request(app)
      .post(`/api/v1/users/activate/${invite.body.activationToken}`)
      .send({ password, fullName: 'Non Admin' });
    const login = await request(app).post('/api/v1/auth/login').send({ username, password });
    expect(login.status).toBe(200);

    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ ...uniqueUser('blocked'), roleName: 'STATE_HQ_OFFICER' });
    expect(res.status).toBe(403);
  });

  describe('the full invite -> activate -> login flow', () => {
    let username;
    let email;
    let activationToken;
    const password = 'Str0ngP@ssw0rd!';

    beforeAll(async () => {
      const generated = uniqueUser('flow');
      username = generated.username;
      email = generated.email;
      const invite = await request(app)
        .post('/api/v1/users/invite')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ username, email, roleName: 'STATE_HQ_OFFICER' });
      activationToken = invite.body.activationToken;
    });

    it('previews the invitation by token', async () => {
      const res = await request(app).get(`/api/v1/users/activate/${activationToken}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(email);
      expect(res.body.roleName).toBe('STATE_HQ_OFFICER');
    });

    it('rejects activation with too short a password', async () => {
      const res = await request(app)
        .post(`/api/v1/users/activate/${activationToken}`)
        .send({ password: 'short', fullName: 'Flow User' });
      expect(res.status).toBe(400);
    });

    it('activates the account, and the new user can then log in', async () => {
      const activateRes = await request(app)
        .post(`/api/v1/users/activate/${activationToken}`)
        .send({ password, fullName: 'Flow User' });
      expect(activateRes.status).toBe(200);

      const loginRes = await request(app).post('/api/v1/auth/login').send({ username, password });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.roles).toContain('STATE_HQ_OFFICER');
    });

    it('rejects re-using the same (now-consumed) activation token', async () => {
      const res = await request(app)
        .post(`/api/v1/users/activate/${activationToken}`)
        .send({ password, fullName: 'Flow User Again' });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('INVITATION_INVALID');
    });

    it('lists the new user for an admin', async () => {
      const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminAccessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((u) => u.username === username)).toBe(true);
    });
  });

  it('admin locking then unlocking a user resets failed_login_count and re-enables login', async () => {
    const { username, email } = uniqueUser('lockflow');
    const password = 'Str0ngP@ssw0rd!';
    const invite = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ username, email, roleName: 'STATE_HQ_OFFICER' });
    await request(app)
      .post(`/api/v1/users/activate/${invite.body.activationToken}`)
      .send({ password, fullName: 'Lock Flow' });

    // Two bad attempts (below the default lockout threshold) so
    // failed_login_count is non-zero before the admin forcibly locks it.
    await request(app).post('/api/v1/auth/login').send({ username, password: 'wrong-1' });
    await request(app).post('/api/v1/auth/login').send({ username, password: 'wrong-2' });

    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    const userId = rows[0].id;

    const lockRes = await request(app)
      .patch(`/api/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'LOCKED' });
    expect(lockRes.status).toBe(200);

    const blockedLogin = await request(app).post('/api/v1/auth/login').send({ username, password });
    expect(blockedLogin.status).toBe(403);

    const unlockRes = await request(app)
      .patch(`/api/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'ACTIVE' });
    expect(unlockRes.status).toBe(200);

    const { rows: refreshed } = await pool.query(
      'SELECT failed_login_count FROM users WHERE id = $1',
      [userId],
    );
    expect(refreshed[0].failed_login_count).toBe(0);

    const okLogin = await request(app).post('/api/v1/auth/login').send({ username, password });
    expect(okLogin.status).toBe(200);
  });

  it('replacing a user\'s roles is reflected on their next login', async () => {
    const { username, email } = uniqueUser('roleflow');
    const password = 'Str0ngP@ssw0rd!';
    const invite = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ username, email, roleName: 'STATE_HQ_OFFICER' });
    await request(app)
      .post(`/api/v1/users/activate/${invite.body.activationToken}`)
      .send({ password, fullName: 'Role Flow' });

    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    const userId = rows[0].id;

    // The police-hierarchy model treats a user as holding one position at
    // a time, but PUT /:id/roles still supports replacing with any set of
    // known role names — reassigning to a single different role here.
    const putRes = await request(app)
      .put(`/api/v1/users/${userId}/roles`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ roleNames: ['ADMINISTRATION_HQ_OFFICER'] });
    expect(putRes.status).toBe(200);

    const loginRes = await request(app).post('/api/v1/auth/login').send({ username, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.roles).toEqual(['ADMINISTRATION_HQ_OFFICER']);
  });

  it('creates and lists departments', async () => {
    const name = `Test Wing ${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const createRes = await request(app)
      .post('/api/v1/users/departments')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name, unitType: 'WING' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.unit_type).toBe('WING');

    const listRes = await request(app)
      .get('/api/v1/users/departments')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((d) => d.id === createRes.body.id)).toBe(true);
  });

  it('route-ordering regression: GET /users/departments is not swallowed by GET /users/:id', async () => {
    const res = await request(app)
      .get('/api/v1/users/departments')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  describe('GET /users/lookup — any authenticated user may search usernames (feature 15 recipient picker)', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/users/lookup?q=admin');
      expect(res.status).toBe(401);
    });

    it('finds the bootstrap admin by a partial username match, without leaking email/roles/status', async () => {
      const res = await request(app)
        .get('/api/v1/users/lookup?q=admin')
        .set('Authorization', `Bearer ${adminAccessToken}`);
      expect(res.status).toBe(200);
      const match = res.body.find((u) => u.username === process.env.BOOTSTRAP_ADMIN_USERNAME);
      expect(match).toBeTruthy();
      expect(match.email).toBeUndefined();
      expect(match.status).toBeUndefined();
    });

    it('rejects an empty query', async () => {
      const res = await request(app)
        .get('/api/v1/users/lookup?q=')
        .set('Authorization', `Bearer ${adminAccessToken}`);
      expect(res.status).toBe(400);
    });
  });
});
