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

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-sharing-test-${Date.now()}`);

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');
const { createActivatedUser } = require('./helpers/create-user');

const app = buildApp();

afterAll(async () => {
  await fs.rm(process.env.STORAGE_ROOT_PATH, { recursive: true, force: true });
  await pool.end();
});

describe('sharing module — time-limited access grants, layered on the three-layer permission engine', () => {
  let owner; // COMMISSIONERATE_ADMIN, case owner, has SHARE
  let forensic; // COMMISSIONERATE_OFFICER, case member, does NOT have SHARE
  let outsider; // never a case member, and not shared with (yet)
  let caseId;
  let documentId;

  beforeAll(async () => {
    owner = await createActivatedUser(app, 'COMMISSIONERATE_ADMIN');
    forensic = await createActivatedUser(app, 'COMMISSIONERATE_OFFICER');
    outsider = await createActivatedUser(app, 'EXTERNAL_UNIT_OFFICER');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Sharing Test Case' });
    caseId = created.body.id;

    const addMember = await request(app)
      .post(`/api/v1/cases/${caseId}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ userId: forensic.userId, caseRole: 'FORENSIC' });
    expect(addMember.status).toBe(201);

    const upload = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('caseId', caseId)
      .field('title', 'Sharable report')
      .attach('file', Buffer.from('sharable-bytes'), { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    documentId = upload.body.id;
  });

  it('a total outsider cannot view the document before any share exists', async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('forbids a case member without SHARE from creating a share', async () => {
    const res = await request(app)
      .post(`/api/v1/sharing/documents/${documentId}/shares`)
      .set('Authorization', `Bearer ${forensic.accessToken}`)
      .send({ toUserId: outsider.userId });
    expect(res.status).toBe(403);
  });

  it('forbids sharing a document with yourself', async () => {
    const res = await request(app)
      .post(`/api/v1/sharing/documents/${documentId}/shares`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ toUserId: owner.userId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RECIPIENT');
  });

  describe('grant -> access -> revoke', () => {
    let shareId;

    it('grants a 72h view-only share to a non-case-member', async () => {
      const res = await request(app)
        .post(`/api/v1/sharing/documents/${documentId}/shares`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: outsider.userId, permission: 'VIEW', expiresInHours: 72, reason: 'Court request' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.permission_code).toBe('VIEW');
      shareId = res.body.id;
    });

    it('the recipient can now view the document purely via the share, without case membership', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(res.status).toBe(200);
    });

    it('the share appears in the document’s share list and the recipient’s "shared with me" list', async () => {
      const docShares = await request(app)
        .get(`/api/v1/sharing/documents/${documentId}/shares`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(docShares.status).toBe(200);
      expect(docShares.body.some((s) => s.id === shareId && s.status === 'ACTIVE')).toBe(true);

      const mine = await request(app)
        .get('/api/v1/sharing/mine')
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(mine.status).toBe(200);
      expect(mine.body.some((s) => s.id === shareId)).toBe(true);
      expect(mine.body[0].document_title).toBe('Sharable report');
    });

    it('explicitly revoking the share immediately blocks further access', async () => {
      const revoke = await request(app)
        .post(`/api/v1/sharing/documents/${documentId}/shares/${shareId}/revoke`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(revoke.status).toBe(200);
      expect(revoke.body.status).toBe('REVOKED');

      const res = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('cannot revoke an already-revoked share', async () => {
      const res = await request(app)
        .post(`/api/v1/sharing/documents/${documentId}/shares/${shareId}/revoke`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(409);
    });
  });

  describe('the literal "done when": a 72h share expires on its own', () => {
    let shareId;

    it('grants a fresh share and confirms access works before expiry', async () => {
      const grant = await request(app)
        .post(`/api/v1/sharing/documents/${documentId}/shares`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: outsider.userId, expiresInHours: 72 });
      expect(grant.status).toBe(201);
      shareId = grant.body.id;

      const before = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(before.status).toBe(200);
    });

    it('once 72h have passed, the grant auto-expires and access is denied — no revoke call needed', async () => {
      // Simulate 72h having elapsed by moving the underlying
      // resource_permissions row's expires_at into the past — the same
      // "manipulate time-dependent state directly via SQL" pattern used
      // throughout this suite (auth.test.js's lockout, evidence's
      // custody-chain tests) rather than actually waiting 72 hours.
      const { rows } = await pool.query('SELECT resource_permission_id FROM document_shares WHERE id = $1', [
        shareId,
      ]);
      await pool.query("UPDATE resource_permissions SET expires_at = now() - interval '1 minute' WHERE id = $1", [
        rows[0].resource_permission_id,
      ]);

      const after = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(after.status).toBe(403);

      const shares = await request(app)
        .get(`/api/v1/sharing/documents/${documentId}/shares`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      const thisShare = shares.body.find((s) => s.id === shareId);
      expect(thisShare.status).toBe('EXPIRED');
    });
  });
});
