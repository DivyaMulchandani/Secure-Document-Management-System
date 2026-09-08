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

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-signatures-test-${Date.now()}`);

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

describe('signatures module — RSA-SHA256 signing + pending-signature queue', () => {
  let adminToken;
  let owner; // INVESTIGATOR, case owner
  let prosecutor; // PROSECUTOR, case member — eligible signer
  let outsider; // never added to the case
  let caseId;

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    adminToken = adminLogin.body.accessToken;

    owner = await createActivatedUser(adminToken, 'INVESTIGATOR');
    prosecutor = await createActivatedUser(adminToken, 'PROSECUTOR');
    outsider = await createActivatedUser(adminToken, 'PROSECUTOR');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Signatures Test Case' });
    caseId = created.body.id;

    const addMember = await request(app)
      .post(`/api/v1/cases/${caseId}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ userId: prosecutor.userId, caseRole: 'PROSECUTOR' });
    expect(addMember.status).toBe(201);
  });

  async function uploadDocument(actor, title) {
    const res = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .field('caseId', caseId)
      .field('title', title)
      .attach('file', Buffer.from(`${title}-bytes`), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  describe('signing keys', () => {
    it('has no active key before one is generated', async () => {
      const res = await request(app)
        .get('/api/v1/signatures/keys/me')
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(res.status).toBe(404);
    });

    it('generates an RSA-2048 signing key, never returning the private material', async () => {
      const res = await request(app)
        .post('/api/v1/signatures/keys')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(201);
      expect(res.body.publicKey).toMatch(/BEGIN PUBLIC KEY/);
      expect(res.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.privateKey).toBeUndefined();
      expect(res.body.private_key_envelope).toBeUndefined();
    });

    it('rotating generates a new key and revokes the old one', async () => {
      const first = await request(app)
        .get('/api/v1/signatures/keys/me')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      const second = await request(app)
        .post('/api/v1/signatures/keys')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(second.body.fingerprint).not.toBe(first.body.fingerprint);

      const { rows } = await pool.query(
        'SELECT status FROM user_keys WHERE id = $1',
        [first.body.id],
      );
      expect(rows[0].status).toBe('REVOKED');
    });
  });

  describe('self-sign', () => {
    let documentId;

    beforeAll(async () => {
      documentId = await uploadDocument(owner, 'Self-signed report');
    });

    it('cannot sign without an active key', async () => {
      const freshSigner = await createActivatedUser(adminToken, 'INVESTIGATOR');
      const addMember = await request(app)
        .post(`/api/v1/cases/${caseId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ userId: freshSigner.userId, caseRole: 'INVESTIGATOR' });
      expect(addMember.status).toBe(201);

      const res = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/sign`)
        .set('Authorization', `Bearer ${freshSigner.accessToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_SIGNING_KEY');
    });

    it('signs the current version, flips is_signed, and moves the document to SIGNED', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/sign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ reason: 'Certified accurate' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('SIGNED');
      expect(res.body.signature).toBeTruthy();
      expect(res.body.verification_code).toMatch(/^[0-9a-f]{24}$/);

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.status).toBe('SIGNED');

      const { rows } = await pool.query('SELECT is_signed FROM document_versions WHERE id = $1', [
        doc.body.current_version_id,
      ]);
      expect(rows[0].is_signed).toBe(true);

      const { rows: auditRows } = await pool.query(
        `SELECT * FROM audit_events WHERE resource_id = $1 AND action = 'DOCUMENT_SIGNED' AND result = 'SUCCESS'`,
        [documentId],
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    });

    it('lists the signature on the document', async () => {
      const res = await request(app)
        .get(`/api/v1/signatures/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('SIGNED');
    });
  });

  describe('pending-signature queue: request -> sign', () => {
    let documentId;
    let signatureId;

    beforeAll(async () => {
      documentId = await uploadDocument(owner, 'Charge sheet needing prosecutor sign-off');
    });

    it('forbids requesting a signature from a non-case-member', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/request`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: outsider.userId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INELIGIBLE_SIGNER');
    });

    it('forbids requesting a signature from yourself', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/request`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: owner.userId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_SIGNER');
    });

    it('requests a signature from the prosecutor, who sees it in their queue', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/request`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: prosecutor.userId, reason: 'Please review and sign' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      signatureId = res.body.id;

      const queue = await request(app)
        .get('/api/v1/signatures/queue')
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(queue.status).toBe(200);
      expect(queue.body.some((r) => r.id === signatureId)).toBe(true);
    });

    it('forbids anyone other than the requested signer from fulfilling it', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/${signatureId}/sign`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_SIGNER');
    });

    it('the prosecutor needs their own key before they can fulfill it', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/${signatureId}/sign`)
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_SIGNING_KEY');

      const genKey = await request(app)
        .post('/api/v1/signatures/keys')
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(genKey.status).toBe(201);
    });

    it('the prosecutor fulfills the request, clearing it from their queue', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/${signatureId}/sign`)
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SIGNED');
      expect(res.body.signer_id).toBe(prosecutor.userId);

      const queue = await request(app)
        .get('/api/v1/signatures/queue')
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(queue.body.some((r) => r.id === signatureId)).toBe(false);
    });

    it('cannot fulfill (or decline) an already-resolved request', async () => {
      const res = await request(app)
        .post(`/api/v1/signatures/${signatureId}/sign`)
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(res.status).toBe(409);
    });
  });

  describe('pending-signature queue: request -> decline', () => {
    it('the prosecutor can decline instead of signing, reverting to no pending request', async () => {
      const documentId = await uploadDocument(owner, 'Document the prosecutor will decline');
      const request_ = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/request`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: prosecutor.userId });
      const signatureId = request_.body.id;

      const decline = await request(app)
        .post(`/api/v1/signatures/${signatureId}/decline`)
        .set('Authorization', `Bearer ${prosecutor.accessToken}`)
        .send({ reason: 'Not my document to sign' });
      expect(decline.status).toBe(200);
      expect(decline.body.status).toBe('DECLINED');
      expect(decline.body.decline_reason).toBe('Not my document to sign');

      const queue = await request(app)
        .get('/api/v1/signatures/queue')
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(queue.body.some((r) => r.id === signatureId)).toBe(false);
    });
  });

  describe('stale request: the document changes after the request is made', () => {
    it('rejects fulfilling a request whose version is no longer current', async () => {
      const documentId = await uploadDocument(owner, 'Document that gets a new version mid-request');
      const req = await request(app)
        .post(`/api/v1/signatures/documents/${documentId}/request`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: prosecutor.userId });
      const signatureId = req.body.id;

      const newVersion = await request(app)
        .post(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('changeNote', 'Fixed a typo')
        .attach('file', Buffer.from('updated content'), { filename: 'v2.pdf', contentType: 'application/pdf' });
      expect(newVersion.status).toBe(201);

      const fulfill = await request(app)
        .post(`/api/v1/signatures/${signatureId}/sign`)
        .set('Authorization', `Bearer ${prosecutor.accessToken}`);
      expect(fulfill.status).toBe(409);
      expect(fulfill.body.error.code).toBe('STALE_REQUEST');
    });
  });
});
