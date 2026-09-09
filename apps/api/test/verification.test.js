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

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-verification-test-${Date.now()}`);

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');
const { createActivatedUser } = require('./helpers/create-user');

const app = buildApp();

afterAll(async () => {
  await fs.rm(process.env.STORAGE_ROOT_PATH, { recursive: true, force: true });
  await pool.end();
});

describe('verification module — the four-check portal (internal + external-verifier path)', () => {
  let owner; // COMMISSIONERATE_ADMIN, case owner, does the signing
  let outsider; // never added to the case
  let caseId;

  beforeAll(async () => {
    owner = await createActivatedUser(app, 'COMMISSIONERATE_ADMIN');
    outsider = await createActivatedUser(app, 'EXTERNAL_UNIT_OFFICER');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Verification Portal Test Case' });
    caseId = created.body.id;

    const genKey = await request(app)
      .post('/api/v1/signatures/keys')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(genKey.status).toBe(201);
  });

  async function uploadAndSign(title) {
    const upload = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('caseId', caseId)
      .field('title', title)
      .attach('file', Buffer.from(`${title}-bytes`), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const documentId = upload.body.id;

    const sign = await request(app)
      .post(`/api/v1/signatures/documents/${documentId}/sign`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Final and accurate' });
    expect(sign.status).toBe(201);

    return { documentId, signature: sign.body };
  }

  describe('internal verification', () => {
    it('returns UNSIGNED for a document with no signature, without logging a check breakdown', async () => {
      const upload = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Never signed')
        .attach('file', Buffer.from('unsigned bytes'), { filename: 'u.pdf', contentType: 'application/pdf' });

      const res = await request(app)
        .get(`/api/v1/verification/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UNSIGNED');

      const { rows } = await pool.query('SELECT * FROM verification_records WHERE document_id = $1', [
        upload.body.id,
      ]);
      expect(rows.length).toBe(0);
    });

    it('forbids a non-case-member from verifying', async () => {
      const { documentId } = await uploadAndSign('Members-only document');
      const res = await request(app)
        .get(`/api/v1/verification/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('an untampered signed document verifies as AUTHENTIC on all four checks', async () => {
      const { documentId } = await uploadAndSign('Authentic report');

      const res = await request(app)
        .get(`/api/v1/verification/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AUTHENTIC');
      expect(res.body.checks).toEqual({
        hashCheck: true,
        signatureCheck: true,
        ledgerCheck: true,
        versionCheck: true,
      });
      expect(res.body.verificationCode).toMatch(/^[0-9a-f]{24}$/);

      const { rows } = await pool.query(
        `SELECT * FROM verification_records WHERE document_id = $1 AND source = 'INTERNAL'`,
        [documentId],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].overall_result).toBe('AUTHENTIC');
      expect(rows[0].verified_by).toBe(owner.userId);
    });
  });

  describe('tamper detection', () => {
    it('flags TAMPERED when the signature’s frozen hash no longer matches the stored content', async () => {
      const { documentId, signature } = await uploadAndSign('Document that gets tampered');

      // Corrupt the ground-truth hash frozen on the signature row
      // directly at the DB layer (bypassing the app entirely) — same
      // "corrupt the recorded value, not the ciphertext" pattern as
      // documents.test.js's integrity-failure test, so AES-GCM
      // decryption still succeeds and this proves the SHA-256 ground
      // truth check specifically, independent of GCM's own auth tag.
      await pool.query(`UPDATE document_signatures SET signed_hash = repeat('0', 64) WHERE id = $1`, [
        signature.id,
      ]);

      const res = await request(app)
        .get(`/api/v1/verification/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('TAMPERED');
      expect(res.body.checks.hashCheck).toBe(false);

      const { rows } = await pool.query(
        `SELECT overall_result FROM verification_records WHERE document_signature_id = $1`,
        [signature.id],
      );
      expect(rows[0].overall_result).toBe('TAMPERED');
    });

    it('hash_check and signature_check are genuinely independent — a corrupted signature blob alone still fails verification even though the content hash still matches', async () => {
      const { documentId, signature } = await uploadAndSign('Document with a forged signature blob');

      await pool.query(`UPDATE document_signatures SET signature = 'not-a-real-signature' WHERE id = $1`, [
        signature.id,
      ]);

      const res = await request(app)
        .get(`/api/v1/verification/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.body.status).toBe('TAMPERED');
      expect(res.body.checks.hashCheck).toBe(true);
      expect(res.body.checks.signatureCheck).toBe(false);
    });
  });

  describe('superseded signature', () => {
    it('flags SUPERSEDED when the document has moved to a new version since signing', async () => {
      const { documentId } = await uploadAndSign('Document that gets a new version after signing');

      const newVersion = await request(app)
        .post(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('changeNote', 'Post-signature correction')
        .attach('file', Buffer.from('new content after signing'), {
          filename: 'v2.pdf',
          contentType: 'application/pdf',
        });
      expect(newVersion.status).toBe(201);

      const res = await request(app)
        .get(`/api/v1/verification/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUPERSEDED');
      expect(res.body.checks.versionCheck).toBe(false);
      expect(res.body.checks.hashCheck).toBe(true);
      expect(res.body.checks.signatureCheck).toBe(true);
    });
  });

  describe('external-verifier path (public, unauthenticated)', () => {
    it('verifies a valid code without any authentication, returning a minimal payload', async () => {
      const { signature } = await uploadAndSign('Publicly verifiable document');

      const res = await request(app).get(`/api/v1/verification/public/${signature.verification_code}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AUTHENTIC');
      expect(res.body.signerUsername).toBeTruthy();
      // Deliberately minimal — no case/document identifiers leaked to an
      // unauthenticated caller.
      expect(res.body.documentId).toBeUndefined();
      expect(res.body.caseId).toBeUndefined();
      expect(res.body.verificationCode).toBeUndefined();
    });

    it('returns 404 for an unknown/bogus code', async () => {
      const res = await request(app).get('/api/v1/verification/public/0000000000000000deadbeef');
      expect(res.status).toBe(404);
      expect(res.body.status).toBe('NOT_FOUND');
    });

    it('flags a tampered document as TAMPERED through the public path too', async () => {
      const { signature } = await uploadAndSign('Publicly tampered document');
      await pool.query(`UPDATE document_signatures SET signed_hash = repeat('1', 64) WHERE id = $1`, [
        signature.id,
      ]);

      const res = await request(app).get(`/api/v1/verification/public/${signature.verification_code}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('TAMPERED');
    });
  });
});
