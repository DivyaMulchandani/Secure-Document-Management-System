'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://invalid/invalid';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.ENCRYPTION_MASTER_KEY = 'test-master-key';

const os = require('os');
const path = require('path');
const fs = require('fs/promises');

process.env.STORAGE_ROOT_PATH = path.join(os.tmpdir(), `secure-dms-storage-test-${Date.now()}`);

const storage = require('../src/services/storage');
const { PathTraversalError } = require('../src/services/storage/local-fs-adapter');

afterAll(async () => {
  await fs.rm(process.env.STORAGE_ROOT_PATH, { recursive: true, force: true });
});

describe('local filesystem storage adapter', () => {
  it('round-trips a buffer through put/get/exists/remove', async () => {
    const key = 'case-001/doc-001/v1.bin';
    const payload = Buffer.from('sprint-0-storage-round-trip');

    await storage.put(key, payload);
    expect(await storage.exists(key)).toBe(true);

    const readBack = await storage.get(key);
    expect(readBack.equals(payload)).toBe(true);

    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('rejects a storage key that attempts path traversal', async () => {
    await expect(storage.put('../../etc/passwd', Buffer.from('nope'))).rejects.toThrow(
      PathTraversalError,
    );
  });

  it('rejects an absolute path used as a storage key', async () => {
    await expect(storage.get('/etc/passwd')).rejects.toThrow(PathTraversalError);
  });

  it('throws NotFoundError for a missing key', async () => {
    await expect(storage.get('does/not/exist.bin')).rejects.toMatchObject({
      code: 'STORAGE_OBJECT_NOT_FOUND',
    });
  });
});
