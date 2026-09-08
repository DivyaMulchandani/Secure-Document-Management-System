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

/** Invite + activate + log in a fresh user with the given global role; returns { userId, accessToken }. */
async function createActivatedUser(adminToken, roleName) {
  const username = unique(roleName.toLowerCase());
  const email = `${username}@example.com`;
  const password = 'Str0ngP@ssw0rd!';

  const invite = await request(app)
    .post('/api/v1/users/invite')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username, email, roleName });
  expect(invite.status).toBe(200);

  const activate = await request(app)
    .post(`/api/v1/users/activate/${invite.body.activationToken}`)
    .send({ password, fullName: username });
  expect(activate.status).toBe(200);

  const login = await request(app).post('/api/v1/auth/login').send({ username, password });
  expect(login.status).toBe(200);

  return { userId: login.body.user.id, accessToken: login.body.accessToken, username };
}

describe('cases module + permission engine', () => {
  let adminToken;
  let investigator; // { userId, accessToken }

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken;

    investigator = await createActivatedUser(adminToken, 'INVESTIGATOR');
  });

  it('lets an investigator create a case with a year-scoped sequential case number', async () => {
    const res = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${investigator.accessToken}`)
      .send({ title: 'Test Case Alpha' });

    expect(res.status).toBe(201);
    expect(res.body.case_number).toMatch(new RegExp(`^CASE-${new Date().getFullYear()}-\\d{4}$`));
    expect(res.body.status).toBe('OPEN');
    expect(res.body.owner_id).toBe(investigator.userId);
  });

  it('forbids a role with no "create case" ceiling (e.g. a fresh AUDITOR) from creating a case', async () => {
    const auditor = await createActivatedUser(adminToken, 'AUDITOR');
    const res = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${auditor.accessToken}`)
      .send({ title: 'Should Not Be Created' });
    expect(res.status).toBe(403);
  });

  describe('three-layer access on a single case', () => {
    let caseId;
    let outsider; // never added to the case, no grant either
    let viewerMember;

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/cases')
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ title: 'Three-Layer Test Case' });
      caseId = created.body.id;

      outsider = await createActivatedUser(adminToken, 'PROSECUTOR');
      viewerMember = await createActivatedUser(adminToken, 'PROSECUTOR');
    });

    it('the creator (case OWNER) can view and edit the case', async () => {
      const getRes = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${investigator.accessToken}`);
      expect(getRes.status).toBe(200);

      const patchRes = await request(app)
        .patch(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ description: 'Updated by owner' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.description).toBe('Updated by owner');
    });

    it('an unrelated user with no case membership and no grant is denied (RBAC ceiling alone is not enough)', async () => {
      const res = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('an ADMINISTRATOR who is NOT a case member is ALSO denied — no blanket admin bypass', async () => {
      const res = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it('but an ADMINISTRATOR still sees the case in the unrestricted list (oversight, not content access)', async () => {
      const res = await request(app).get('/api/v1/cases').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((c) => c.id === caseId)).toBe(true);
    });

    it('the owner adds a VIEWER member, who can VIEW but not EDIT (case_role ceiling)', async () => {
      const addRes = await request(app)
        .post(`/api/v1/cases/${caseId}/members`)
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ userId: viewerMember.userId, caseRole: 'VIEWER' });
      expect(addRes.status).toBe(201);

      const viewRes = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${viewerMember.accessToken}`);
      expect(viewRes.status).toBe(200);

      const editRes = await request(app)
        .patch(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${viewerMember.accessToken}`)
        .send({ description: 'Viewer should not be able to do this' });
      expect(editRes.status).toBe(403);
    });

    it('a resource_permissions grant lets the previously-unrelated outsider VIEW the case without case membership', async () => {
      const stillDenied = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(stillDenied.status).toBe(403);

      const grantRes = await request(app)
        .post('/api/v1/permissions/grants')
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ resourceType: 'CASE', resourceId: caseId, userId: outsider.userId, permissionCode: 'VIEW' });
      expect(grantRes.status).toBe(201);

      const nowAllowed = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(nowAllowed.status).toBe(200);

      // Revoking the grant removes access again.
      const revokeRes = await request(app)
        .delete(`/api/v1/permissions/grants/${grantRes.body.id}`)
        .set('Authorization', `Bearer ${investigator.accessToken}`);
      expect(revokeRes.status).toBe(200);

      const deniedAgain = await request(app)
        .get(`/api/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(deniedAgain.status).toBe(403);
    });

    it('cannot remove the last owner of a case', async () => {
      const res = await request(app)
        .delete(`/api/v1/cases/${caseId}/members/${investigator.userId}`)
        .set('Authorization', `Bearer ${investigator.accessToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CANNOT_REMOVE_LAST_OWNER');
    });
  });

  describe('case status state machine', () => {
    let caseId;

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/cases')
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ title: 'Status Machine Test Case' });
      caseId = created.body.id;
    });

    it('allows a legal transition (OPEN -> UNDER_INVESTIGATION)', async () => {
      const res = await request(app)
        .patch(`/api/v1/cases/${caseId}/status`)
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ status: 'UNDER_INVESTIGATION' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UNDER_INVESTIGATION');
    });

    it('rejects an illegal jump (UNDER_INVESTIGATION -> CLOSED)', async () => {
      const res = await request(app)
        .patch(`/api/v1/cases/${caseId}/status`)
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ status: 'CLOSED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
    });

    it('walks the legal chain to CLOSED, then requires an administrator to reopen', async () => {
      for (const status of ['UNDER_REVIEW', 'SUBMITTED', 'CLOSED']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app)
          .patch(`/api/v1/cases/${caseId}/status`)
          .set('Authorization', `Bearer ${investigator.accessToken}`)
          .send({ status });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
      }

      const reopenAsInvestigator = await request(app)
        .patch(`/api/v1/cases/${caseId}/status`)
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ status: 'UNDER_INVESTIGATION' });
      expect(reopenAsInvestigator.status).toBe(403);

      // Admin isn't a case member, so must first be added before EDIT
      // (and thus the reopen action) is even reachable.
      await request(app)
        .post(`/api/v1/cases/${caseId}/members`)
        .set('Authorization', `Bearer ${investigator.accessToken}`)
        .send({ userId: (await getAdminUserId()), caseRole: 'OWNER' });

      const reopenAsAdmin = await request(app)
        .patch(`/api/v1/cases/${caseId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'UNDER_INVESTIGATION' });
      expect(reopenAsAdmin.status).toBe(200);
      expect(reopenAsAdmin.body.status).toBe('UNDER_INVESTIGATION');
    });

    it('appended a coherent, chained audit trail for every status change above', async () => {
      const { rows } = await pool.query(
        `SELECT id, action, previous_hash, event_hash FROM audit_events
         WHERE case_id = $1 ORDER BY id`,
        [caseId],
      );
      expect(rows.some((r) => r.action === 'CASE_CREATED')).toBe(true);
      expect(rows.filter((r) => r.action === 'CASE_STATUS_CHANGED').length).toBeGreaterThanOrEqual(4);

      const { rows: allEvents } = await pool.query(
        'SELECT id, previous_hash, event_hash FROM audit_events ORDER BY id',
      );
      for (let i = 1; i < allEvents.length; i += 1) {
        expect(allEvents[i].previous_hash).toBe(allEvents[i - 1].event_hash);
      }
    });
  });

  async function getAdminUserId() {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [
      process.env.BOOTSTRAP_ADMIN_USERNAME,
    ]);
    return rows[0].id;
  }
});
