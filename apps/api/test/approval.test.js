'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://secure_dms:changeme_dev_only@localhost:5432/secure_dms_dev';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY || 'test-master-key';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'master-v1';
process.env.BOOTSTRAP_ADMIN_USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
process.env.BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@secure-dms.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe_Bootstrap_123!';
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const os = require('os');
const path = require('path');
const fs = require('fs/promises');

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-approval-test-${Date.now()}`);

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');

const app = buildApp();

afterAll(async () => {
  await fs.rm(process.env.STORAGE_ROOT_PATH, { recursive: true, force: true });
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

describe('approval module — draft -> review -> approve/reject/revise -> sign -> final', () => {
  let adminToken;
  let owner; // INVESTIGATOR, submits documents
  let approver1; // PROSECUTOR, case member, step 0
  let approver2; // FORENSIC_OFFICER, case member, step 1
  let outsider; // never a case member
  let caseId;

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    adminToken = adminLogin.body.accessToken;

    owner = await createActivatedUser(adminToken, 'INVESTIGATOR');
    approver1 = await createActivatedUser(adminToken, 'PROSECUTOR');
    approver2 = await createActivatedUser(adminToken, 'FORENSIC_OFFICER');
    outsider = await createActivatedUser(adminToken, 'PROSECUTOR');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Approval Workflow Test Case' });
    caseId = created.body.id;

    for (const [user, caseRole] of [
      [approver1, 'PROSECUTOR'],
      [approver2, 'FORENSIC'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const addMember = await request(app)
        .post(`/api/v1/cases/${caseId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ userId: user.userId, caseRole });
      expect(addMember.status).toBe(201);
    }
  });

  async function uploadDocument(title) {
    const res = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('caseId', caseId)
      .field('title', title)
      .attach('file', Buffer.from(`${title}-bytes`), { filename: 'd.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('rejects submitting with no approvers', async () => {
    const documentId = await uploadDocument('No approvers');
    const res = await request(app)
      .post(`/api/v1/approval/documents/${documentId}/requests`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ approverIds: [] });
    expect(res.status).toBe(400);
  });

  it('rejects naming yourself as an approver', async () => {
    const documentId = await uploadDocument('Self approver');
    const res = await request(app)
      .post(`/api/v1/approval/documents/${documentId}/requests`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ approverIds: [owner.userId] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_APPROVER');
  });

  it('cannot finalize a document that has never been signed', async () => {
    const documentId = await uploadDocument('Never signed');
    const res = await request(app)
      .post(`/api/v1/approval/documents/${documentId}/finalize`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  describe('the two-step chain drives a document to APPROVED, then signed, then FINAL', () => {
    let documentId;
    let requestId;
    let step1Id;
    let step2Id;

    beforeAll(async () => {
      documentId = await uploadDocument('Two-step charge sheet');
      const submit = await request(app)
        .post(`/api/v1/approval/documents/${documentId}/requests`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ approverIds: [approver1.userId, approver2.userId] });
      expect(submit.status).toBe(201);
      expect(submit.body.status).toBe('PENDING');
      expect(submit.body.steps.length).toBe(2);
      requestId = submit.body.id;
      step1Id = submit.body.steps[0].id;
      step2Id = submit.body.steps[1].id;

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.status).toBe('UNDER_REVIEW');
    });

    it('cannot submit again while already under review', async () => {
      const res = await request(app)
        .post(`/api/v1/approval/documents/${documentId}/requests`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ approverIds: [approver1.userId] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
    });

    it('forbids the second approver from deciding before the first', async () => {
      const res = await request(app)
        .post(`/api/v1/approval/steps/${step2Id}/decide`)
        .set('Authorization', `Bearer ${approver2.accessToken}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_YOUR_TURN');
    });

    it('forbids anyone other than the assigned approver from deciding', async () => {
      const res = await request(app)
        .post(`/api/v1/approval/steps/${step1Id}/decide`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_APPROVER');
    });

    it('the first approver sees it in their inbox; the second does not yet', async () => {
      const inbox1 = await request(app)
        .get('/api/v1/approval/inbox')
        .set('Authorization', `Bearer ${approver1.accessToken}`);
      expect(inbox1.body.some((s) => s.id === step1Id)).toBe(true);

      const inbox2 = await request(app)
        .get('/api/v1/approval/inbox')
        .set('Authorization', `Bearer ${approver2.accessToken}`);
      expect(inbox2.body.some((s) => s.id === step2Id)).toBe(false);
    });

    it('the first approver approves, advancing the chain to the second (document stays UNDER_REVIEW)', async () => {
      const res = await request(app)
        .post(`/api/v1/approval/steps/${step1Id}/decide`)
        .set('Authorization', `Bearer ${approver1.accessToken}`)
        .send({ decision: 'APPROVED', comments: 'Looks right to me' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.status).toBe('UNDER_REVIEW');

      const inbox2 = await request(app)
        .get('/api/v1/approval/inbox')
        .set('Authorization', `Bearer ${approver2.accessToken}`);
      expect(inbox2.body.some((s) => s.id === step2Id)).toBe(true);
    });

    it('cannot re-decide an already-decided step', async () => {
      const res = await request(app)
        .post(`/api/v1/approval/steps/${step1Id}/decide`)
        .set('Authorization', `Bearer ${approver1.accessToken}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(409);
    });

    it('the second (last) approver approves, closing the chain APPROVED and moving the document to APPROVED', async () => {
      const res = await request(app)
        .post(`/api/v1/approval/steps/${step2Id}/decide`)
        .set('Authorization', `Bearer ${approver2.accessToken}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(200);

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.status).toBe('APPROVED');

      const list = await request(app)
        .get(`/api/v1/approval/documents/${documentId}/requests`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(list.body[0].id).toBe(requestId);
      expect(list.body[0].status).toBe('APPROVED');
      expect(list.body[0].steps.every((s) => s.status === 'APPROVED')).toBe(true);
    });

    it('the literal "done when": signing the approved document reaches SIGNED, and finalizing reaches FINAL', async () => {
      const genKey = await request(app)
        .post('/api/v1/signatures/keys')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(genKey.status).toBe(201);

      const sign = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/sign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ reason: 'Final sign-off' });
      expect(sign.status).toBe(201);

      const signedDoc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(signedDoc.body.status).toBe('SIGNED');

      const finalize = await request(app)
        .post(`/api/v1/approval/documents/${documentId}/finalize`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(finalize.status).toBe(200);
      expect(finalize.body.status).toBe('FINAL');
    });
  });

  describe('rejection halts the chain and reverts the document to DRAFT', () => {
    it('a rejection at step 1 never gives step 2 a turn', async () => {
      const documentId = await uploadDocument('Chain that gets rejected');
      const submit = await request(app)
        .post(`/api/v1/approval/documents/${documentId}/requests`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ approverIds: [approver1.userId, approver2.userId] });
      const step1Id = submit.body.steps[0].id;
      const step2Id = submit.body.steps[1].id;

      const reject = await request(app)
        .post(`/api/v1/approval/steps/${step1Id}/decide`)
        .set('Authorization', `Bearer ${approver1.accessToken}`)
        .send({ decision: 'REJECTED', comments: 'Missing signature page' });
      expect(reject.status).toBe(200);
      expect(reject.body.status).toBe('REJECTED');

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.status).toBe('DRAFT');

      // step 2 never becomes actionable — the request is no longer PENDING
      const decideStep2 = await request(app)
        .post(`/api/v1/approval/steps/${step2Id}/decide`)
        .set('Authorization', `Bearer ${approver2.accessToken}`)
        .send({ decision: 'APPROVED' });
      expect(decideStep2.status).toBe(409);

      const inbox2 = await request(app)
        .get('/api/v1/approval/inbox')
        .set('Authorization', `Bearer ${approver2.accessToken}`);
      expect(inbox2.body.some((s) => s.id === step2Id)).toBe(false);
    });
  });

  describe('a revision request also reverts the document to DRAFT, distinct from a hard rejection', () => {
    it('records REVISION_REQUESTED on both the step and the request', async () => {
      const documentId = await uploadDocument('Needs revision');
      const submit = await request(app)
        .post(`/api/v1/approval/documents/${documentId}/requests`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ approverIds: [approver1.userId] });
      const stepId = submit.body.steps[0].id;

      const decide = await request(app)
        .post(`/api/v1/approval/steps/${stepId}/decide`)
        .set('Authorization', `Bearer ${approver1.accessToken}`)
        .send({ decision: 'REVISION_REQUESTED', comments: 'Please attach the evidence log' });
      expect(decide.status).toBe(200);
      expect(decide.body.status).toBe('REVISION_REQUESTED');

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.status).toBe('DRAFT');

      const list = await request(app)
        .get(`/api/v1/approval/documents/${documentId}/requests`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(list.body[0].status).toBe('REVISION_REQUESTED');
    });
  });
});
