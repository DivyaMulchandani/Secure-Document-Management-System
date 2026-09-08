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
const crypto = require('crypto');

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-documents-test-${Date.now()}`);

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

describe('documents module — the spine: encryption, integrity, versioning', () => {
  let adminToken;
  let owner; // investigator, owns the test case
  let caseId;

  beforeAll(async () => {
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    adminToken = adminLogin.body.accessToken;

    owner = await createActivatedUser(adminToken, 'INVESTIGATOR');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Documents Test Case' });
    caseId = created.body.id;
  });

  describe('upload -> download round-trip', () => {
    const plaintext = Buffer.from('This is the original certified document content — v1.');
    let documentId;
    let versionId;
    let storageKey;

    it('uploads a new document (v1.0) and returns it', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Witness Statement')
        .attach('file', plaintext, { filename: 'statement.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(201);
      expect(res.body.currentVersion.version_number).toBe('1.0');
      expect(res.body.duplicateOf).toEqual([]);
      documentId = res.body.id;
      versionId = res.body.currentVersion.id;
      storageKey = res.body.currentVersion.storage_key;
    });

    it('never writes plaintext to disk — the stored object is ciphertext', async () => {
      const onDisk = await fs.readFile(path.join(process.env.STORAGE_ROOT_PATH, storageKey));
      expect(onDisk.equals(plaintext)).toBe(false);
      expect(onDisk.includes(plaintext)).toBe(false);
    });

    it('recorded the correct SHA-256 hash and started integrity_status at UNKNOWN', async () => {
      const { rows } = await pool.query('SELECT sha256_hash, integrity_status FROM document_versions WHERE id = $1', [
        versionId,
      ]);
      expect(rows[0].sha256_hash).toBe(crypto.createHash('sha256').update(plaintext).digest('hex'));
      expect(rows[0].integrity_status).toBe('UNKNOWN');
    });

    it('downloads the current version, decrypting back to the exact original bytes, and flips integrity_status to VERIFIED', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-integrity-status']).toBe('VERIFIED');
      expect(Buffer.compare(res.body, plaintext)).toBe(0);

      const { rows } = await pool.query('SELECT integrity_status FROM document_versions WHERE id = $1', [versionId]);
      expect(rows[0].integrity_status).toBe('VERIFIED');
    });

    it('rejects a disallowed file type at upload', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Should be rejected')
        .attach('file', Buffer.from('PK\x03\x04fake-zip'), { filename: 'bad.zip', contentType: 'application/zip' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });
  });

  describe('duplicate detection (warn, not block)', () => {
    const sharedContent = Buffer.from('Identical bytes uploaded twice on purpose.');

    it('flags a second upload with the same content as a duplicate of the first', async () => {
      const first = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Original')
        .attach('file', sharedContent, { filename: 'a.pdf', contentType: 'application/pdf' });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Re-upload of the same content')
        .attach('file', sharedContent, { filename: 'b.pdf', contentType: 'application/pdf' });

      // NOT blocked — 201, with duplicateOf pointing at the first document.
      expect(second.status).toBe(201);
      expect(second.body.duplicateOf.length).toBe(1);
      expect(second.body.duplicateOf[0].document_id).toBe(first.body.id);
    });
  });

  describe('versioning — no silent overwrite', () => {
    let documentId;
    let v1Id;
    let v1StorageKey;
    const v1Content = Buffer.from('Draft report — contains a typo.');
    const v2Content = Buffer.from('Draft report — typo corrected.');

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Correction Test Doc')
        .attach('file', v1Content, { filename: 'report.pdf', contentType: 'application/pdf' });
      documentId = created.body.id;
      v1Id = created.body.currentVersion.id;
      v1StorageKey = created.body.currentVersion.storage_key;
    });

    it('a correction creates v2.0, preserving v1.0 untouched', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('changeNote', 'Fixed the typo')
        .attach('file', v2Content, { filename: 'report-v2.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(201);
      expect(res.body.version_number).toBe('2.0');

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.current_version_id).toBe(res.body.id);

      const versions = await request(app)
        .get(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(versions.body.map((v) => v.version_number).sort()).toEqual(['1.0', '2.0']);

      // v1's original ciphertext object is still on disk, untouched.
      const v1OnDisk = await fs.readFile(path.join(process.env.STORAGE_ROOT_PATH, v1StorageKey));
      expect(v1OnDisk.length).toBeGreaterThan(0);

      // Downloading v1 explicitly still returns v1's exact original content.
      const v1Download = await request(app)
        .get(`/api/v1/documents/${documentId}/versions/${v1Id}/download`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(Buffer.compare(v1Download.body, v1Content)).toBe(0);
    });

    it('restoring v1 creates a NEW forward version (v3.0) rather than rewinding the pointer', async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${documentId}/versions/${v1Id}/restore`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(201);
      expect(res.body.version_number).toBe('3.0');
      expect(res.body.sha256_hash).toBe(crypto.createHash('sha256').update(v1Content).digest('hex'));

      const versions = await request(app)
        .get(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(versions.body.length).toBe(3);

      const doc = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(doc.body.current_version_id).toBe(res.body.id);

      const download = await request(app)
        .get(`/api/v1/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(Buffer.compare(download.body, v1Content)).toBe(0);
    });
  });

  describe('access control on documents (three-layer engine, DOCUMENT resource type)', () => {
    let documentId;
    let outsider;
    let viewerMember;

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Access Control Test Doc')
        .attach('file', Buffer.from('secret'), { filename: 'secret.pdf', contentType: 'application/pdf' });
      documentId = created.body.id;

      outsider = await createActivatedUser(adminToken, 'PROSECUTOR');
      viewerMember = await createActivatedUser(adminToken, 'PROSECUTOR');
      await request(app)
        .post(`/api/v1/cases/${caseId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ userId: viewerMember.userId, caseRole: 'VIEWER' });
    });

    it('an outsider with no case membership and no grant cannot view or download the document', async () => {
      const getRes = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(getRes.status).toBe(403);

      const downloadRes = await request(app)
        .get(`/api/v1/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(downloadRes.status).toBe(403);

      // "Deny is logged too" — a real security_events(UNAUTH_ACCESS) row exists.
      const { rows } = await pool.query(
        `SELECT * FROM security_events WHERE event_type = 'UNAUTH_ACCESS' AND resource_id = $1 AND user_id = $2`,
        [documentId, outsider.userId],
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it('a case VIEWER can view/download the document but cannot upload a new version or delete it', async () => {
      const getRes = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${viewerMember.accessToken}`);
      expect(getRes.status).toBe(200);

      const versionRes = await request(app)
        .post(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${viewerMember.accessToken}`)
        .attach('file', Buffer.from('should not be allowed'), { filename: 'x.pdf', contentType: 'application/pdf' });
      expect(versionRes.status).toBe(403);

      const deleteRes = await request(app)
        .delete(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${viewerMember.accessToken}`);
      expect(deleteRes.status).toBe(403);
    });

    it('a resource_permissions VIEW grant lets the outsider read the document without case membership', async () => {
      const grant = await request(app)
        .post('/api/v1/permissions/grants')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ resourceType: 'DOCUMENT', resourceId: documentId, userId: outsider.userId, permissionCode: 'VIEW' });
      expect(grant.status).toBe(201);

      const getRes = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(getRes.status).toBe(200);
    });
  });

  describe('integrity failure detection', () => {
    let documentId;
    let versionId;
    const content = Buffer.from('This content will be tampered with on disk.');

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Tamper Test Doc')
        .attach('file', content, { filename: 'tamper.pdf', contentType: 'application/pdf' });
      documentId = created.body.id;
      versionId = created.body.currentVersion.id;
    });

    it('detects and blocks a download when the stored hash no longer matches the decrypted content', async () => {
      // Corrupt the RECORDED hash directly (bypassing the app entirely)
      // rather than the on-disk ciphertext, so decryption still
      // succeeds (proving this is a genuine SHA-256 integrity check,
      // independent of AES-GCM's own auth-tag check) but the recorded
      // hash no longer matches — restored afterward so this doesn't
      // affect any other test.
      const { rows } = await pool.query('SELECT sha256_hash FROM document_versions WHERE id = $1', [versionId]);
      const originalHash = rows[0].sha256_hash;

      try {
        await pool.query("UPDATE document_versions SET sha256_hash = 'deadbeef' WHERE id = $1", [versionId]);

        const res = await request(app)
          .get(`/api/v1/documents/${documentId}/download`)
          .set('Authorization', `Bearer ${owner.accessToken}`);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INTEGRITY_FAILURE');

        const { rows: after } = await pool.query(
          'SELECT integrity_status FROM document_versions WHERE id = $1',
          [versionId],
        );
        expect(after[0].integrity_status).toBe('MODIFIED');

        const { rows: secEvents } = await pool.query(
          `SELECT * FROM security_events WHERE event_type = 'INTEGRITY_FAILURE' AND resource_id = $1`,
          [documentId],
        );
        expect(secEvents.length).toBeGreaterThan(0);
      } finally {
        await pool.query('UPDATE document_versions SET sha256_hash = $1, integrity_status = $2 WHERE id = $3', [
          originalHash,
          'VERIFIED',
          versionId,
        ]);
      }
    });
  });

  describe('comments', () => {
    let documentId;

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Comment Test Doc')
        .attach('file', Buffer.from('doc for comments'), { filename: 'c.pdf', contentType: 'application/pdf' });
      documentId = created.body.id;
    });

    it('adds and lists a comment', async () => {
      const addRes = await request(app)
        .post(`/api/v1/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ body: 'Looks correct to me.' });
      expect(addRes.status).toBe(201);

      const listRes = await request(app)
        .get(`/api/v1/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.some((c) => c.body === 'Looks correct to me.')).toBe(true);
    });
  });

  describe('soft delete', () => {
    let documentId;

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Delete Test Doc')
        .attach('file', Buffer.from('to be deleted'), { filename: 'd.pdf', contentType: 'application/pdf' });
      documentId = created.body.id;
    });

    it('soft-deletes a document (status=DELETED) and blocks further version uploads', async () => {
      const deleteRes = await request(app)
        .delete(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.status).toBe('DELETED');

      const versionRes = await request(app)
        .post(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', Buffer.from('too late'), { filename: 'x.pdf', contentType: 'application/pdf' });
      expect(versionRes.status).toBe(409);
    });
  });

  it('lists document types (reference data)', async () => {
    const res = await request(app).get('/api/v1/documents/types').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((t) => t.code === 'FIR')).toBe(true);
  });
});
