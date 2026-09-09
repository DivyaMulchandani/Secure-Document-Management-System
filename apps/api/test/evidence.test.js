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

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-evidence-test-${Date.now()}`);

const request = require('supertest');
const buildApp = require('../src/app');
const { pool } = require('../src/db/pool');
const { createActivatedUser } = require('./helpers/create-user');

const app = buildApp();

afterAll(async () => {
  await fs.rm(process.env.STORAGE_ROOT_PATH, { recursive: true, force: true });
  await pool.end();
});

describe('evidence module — vault + chain of custody', () => {
  let owner; // COMMISSIONERATE_ADMIN, case owner (initial custodian)
  let recipient; // COMMISSIONERATE_OFFICER, added as a case member (eligible recipient)
  let outsider; // EXTERNAL_UNIT_OFFICER, never added to the case
  let caseId;

  beforeAll(async () => {
    owner = await createActivatedUser(app, 'COMMISSIONERATE_ADMIN');
    recipient = await createActivatedUser(app, 'COMMISSIONERATE_OFFICER');
    outsider = await createActivatedUser(app, 'EXTERNAL_UNIT_OFFICER');

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Evidence Vault Test Case' });
    caseId = created.body.id;

    const addMember = await request(app)
      .post(`/api/v1/cases/${caseId}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ userId: recipient.userId, caseRole: 'FORENSIC' });
    expect(addMember.status).toBe(201);
  });

  describe('register -> seal -> verify', () => {
    let evidenceId;
    const content = Buffer.from('seized-device-image-bytes');

    it('registers evidence with an artifact and a year/case-scoped evidence number', async () => {
      const res = await request(app)
        .post('/api/v1/evidence')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Seized hard drive image')
        .field('category', 'Digital')
        .attach('file', content, { filename: 'drive.img', contentType: 'application/pdf' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('REGISTERED');
      expect(res.body.evidence_number).toMatch(/^EV-.+-\d{2}$/);
      expect(res.body.current_custodian_id).toBe(owner.userId);
      expect(res.body.artifacts.length).toBe(1);
      evidenceId = res.body.id;
    });

    it('forbids a non-case-member from registering evidence on this case', async () => {
      const res = await request(app)
        .post('/api/v1/evidence')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Should be blocked')
        .attach('file', Buffer.from('x'), { filename: 'x.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(403);
    });

    it('forbids sealing by anyone other than the current custodian', async () => {
      const res = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/seal`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_CUSTODIAN');
    });

    it('seals the evidence (REGISTERED -> SEALED)', async () => {
      const res = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/seal`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SEALED');
    });

    it('rejects an illegal transition (sealing an already-sealed item)', async () => {
      const res = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/seal`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
    });

    it('verifies integrity and advances SEALED -> IN_CUSTODY', async () => {
      const res = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/verify`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.allMatch).toBe(true);
      expect(res.body.advancedToInCustody).toBe(true);

      const getRes = await request(app)
        .get(`/api/v1/evidence/${evidenceId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(getRes.body.status).toBe('IN_CUSTODY');
      expect(getRes.body.artifacts[0].integrity_status).toBe('VERIFIED');
    });

    describe('two-party transfer — the literal "done when"', () => {
      let transferId;

      it('forbids requesting a transfer to someone who is not a case member', async () => {
        const res = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/transfers`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ toUserId: outsider.userId, reason: 'test' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INELIGIBLE_CUSTODIAN');
      });

      it('requests a transfer to the eligible recipient (IN_CUSTODY -> IN_TRANSIT, custody event PENDING)', async () => {
        const res = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/transfers`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ toUserId: recipient.userId, reason: 'Forensic analysis' });
        expect(res.status).toBe(201);
        transferId = res.body.transferId;

        const getRes = await request(app)
          .get(`/api/v1/evidence/${evidenceId}`)
          .set('Authorization', `Bearer ${owner.accessToken}`);
        expect(getRes.body.status).toBe('IN_TRANSIT');
      });

      it('forbids anyone other than the intended recipient from accepting', async () => {
        const res = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/transfers/${transferId}/accept`)
          .set('Authorization', `Bearer ${owner.accessToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('NOT_RECIPIENT');
      });

      it('the recipient accepts: integrity-checked, RECEIVED, and produces BOTH a custody event and an audit event', async () => {
        const res = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/transfers/${transferId}/accept`)
          .set('Authorization', `Bearer ${recipient.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('RECEIVED');
        expect(res.body.current_custodian_id).toBe(recipient.userId);

        const { rows: custodyRows } = await pool.query(
          `SELECT * FROM custody_events WHERE evidence_id = $1 AND action = 'RECEIVE' AND status = 'COMPLETED'`,
          [evidenceId],
        );
        expect(custodyRows.length).toBe(1);
        expect(custodyRows[0].integrity_verified).toBe(true);
        expect(custodyRows[0].to_user_id).toBe(recipient.userId);

        const { rows: auditRows } = await pool.query(
          `SELECT * FROM audit_events WHERE resource_id = $1 AND action = 'EVIDENCE_TRANSFER' AND result = 'SUCCESS'`,
          [evidenceId],
        );
        expect(auditRows.length).toBeGreaterThanOrEqual(1);
      });

      it('analysis -> return -> archive continues the custody trail under the new custodian', async () => {
        const start = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/analysis/start`)
          .set('Authorization', `Bearer ${recipient.accessToken}`);
        expect(start.status).toBe(200);
        expect(start.body.status).toBe('UNDER_ANALYSIS');

        const complete = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/analysis/complete`)
          .set('Authorization', `Bearer ${recipient.accessToken}`);
        expect(complete.status).toBe(200);
        expect(complete.body.status).toBe('IN_CUSTODY');

        const ret = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/return`)
          .set('Authorization', `Bearer ${recipient.accessToken}`);
        expect(ret.status).toBe(200);
        expect(ret.body.status).toBe('RETURNED');

        // Archiving is a case-closure action, not a custody hand-off — it's
        // gated on PERMISSIONS.ARCHIVE (which the case owner has and the
        // forensic-officer recipient/custodian deliberately doesn't), not on
        // who currently holds the item. See evidence.service.js#archiveEvidence.
        const archive = await request(app)
          .post(`/api/v1/evidence/${evidenceId}/archive`)
          .set('Authorization', `Bearer ${owner.accessToken}`);
        expect(archive.status).toBe(200);
        expect(archive.body.status).toBe('ARCHIVED');
      });

      it('the full custody timeline is chronological and internally consistent', async () => {
        const res = await request(app)
          .get(`/api/v1/evidence/${evidenceId}/custody`)
          .set('Authorization', `Bearer ${owner.accessToken}`);
        expect(res.status).toBe(200);
        const actions = res.body.map((e) => e.action);
        expect(actions).toEqual(['REGISTER', 'SEAL', 'TRANSFER_REQUEST', 'RECEIVE', 'ANALYZE', 'ANALYZE', 'RETURN', 'ARCHIVE']);
      });

      it('the custody chain verifies as intact', async () => {
        const res = await request(app)
          .get(`/api/v1/evidence/${evidenceId}/custody/verify`)
          .set('Authorization', `Bearer ${owner.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.intact).toBe(true);
        expect(res.body.brokenAtId).toBeNull();
      });

      it('detects a tampered custody chain', async () => {
        const { rows } = await pool.query(
          'SELECT id, event_hash FROM custody_events WHERE evidence_id = $1 ORDER BY created_at ASC LIMIT 1',
          [evidenceId],
        );
        const { id: targetId, event_hash: originalHash } = rows[0];
        try {
          await pool.query("UPDATE custody_events SET event_hash = 'deadbeef' WHERE id = $1", [targetId]);
          const res = await request(app)
            .get(`/api/v1/evidence/${evidenceId}/custody/verify`)
            .set('Authorization', `Bearer ${owner.accessToken}`);
          expect(res.body.intact).toBe(false);
          expect(res.body.brokenAtId).toBe(targetId);
        } finally {
          await pool.query('UPDATE custody_events SET event_hash = $1 WHERE id = $2', [originalHash, targetId]);
        }
      });
    });
  });

  describe('reject flow', () => {
    let evidenceId;

    beforeAll(async () => {
      const reg = await request(app)
        .post('/api/v1/evidence')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Item pending rejection test')
        .attach('file', Buffer.from('reject-me'), { filename: 'r.pdf', contentType: 'application/pdf' });
      evidenceId = reg.body.id;
      await request(app).post(`/api/v1/evidence/${evidenceId}/seal`).set('Authorization', `Bearer ${owner.accessToken}`);
      await request(app).post(`/api/v1/evidence/${evidenceId}/verify`).set('Authorization', `Bearer ${owner.accessToken}`);
    });

    it('the recipient can reject a transfer, reverting custody to the sender', async () => {
      const transferRes = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/transfers`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: recipient.userId });
      const transferId = transferRes.body.transferId;

      const rejectRes = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/transfers/${transferId}/reject`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ reason: 'Wrong recipient' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('IN_CUSTODY');
      expect(rejectRes.body.current_custodian_id).toBe(owner.userId);

      const { rows } = await pool.query(
        `SELECT * FROM custody_events WHERE evidence_id = $1 AND action = 'RECEIVE' AND status = 'REJECTED'`,
        [evidenceId],
      );
      expect(rows.length).toBe(1);
    });
  });

  describe('integrity violation blocks a transfer', () => {
    let evidenceId;
    let transferId;

    beforeAll(async () => {
      const reg = await request(app)
        .post('/api/v1/evidence')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Item that will be tampered')
        .attach('file', Buffer.from('tamper-me'), { filename: 't.pdf', contentType: 'application/pdf' });
      evidenceId = reg.body.id;
      await request(app).post(`/api/v1/evidence/${evidenceId}/seal`).set('Authorization', `Bearer ${owner.accessToken}`);
      await request(app).post(`/api/v1/evidence/${evidenceId}/verify`).set('Authorization', `Bearer ${owner.accessToken}`);
      const transferRes = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/transfers`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ toUserId: recipient.userId });
      transferId = transferRes.body.transferId;

      // Simulate tampering with the stored artifact hash directly at the
      // DB layer (bypassing the app) — the artifact bytes on disk no
      // longer match what's recorded.
      await pool.query(
        `UPDATE evidence_artifacts SET sha256_hash = repeat('0', 64) WHERE evidence_id = $1`,
        [evidenceId],
      );
    });

    it('acceptance is blocked, a CUSTODY_VIOLATION security event is raised, and the item stays IN_TRANSIT', async () => {
      const res = await request(app)
        .post(`/api/v1/evidence/${evidenceId}/transfers/${transferId}/accept`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CUSTODY_VIOLATION');

      const { rows: secEvents } = await pool.query(
        `SELECT * FROM security_events WHERE resource_id = $1 AND event_type = 'CUSTODY_VIOLATION'`,
        [evidenceId],
      );
      expect(secEvents.length).toBe(1);

      const getRes = await request(app)
        .get(`/api/v1/evidence/${evidenceId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(getRes.body.status).toBe('IN_TRANSIT');
    });
  });

  describe('artifact download', () => {
    it('decrypts and returns the exact original bytes, verified', async () => {
      const content = Buffer.from('roundtrip-check-bytes');
      const reg = await request(app)
        .post('/api/v1/evidence')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('caseId', caseId)
        .field('title', 'Download roundtrip test')
        .attach('file', content, { filename: 'd.pdf', contentType: 'application/pdf' });
      const artifactId = reg.body.artifacts[0].id;

      const res = await request(app)
        .get(`/api/v1/evidence/${reg.body.id}/artifacts/${artifactId}/download`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['x-integrity-status']).toBe('VERIFIED');
      expect(Buffer.from(res.body).equals(content)).toBe(true);
    });
  });
});
