'use strict';

const { Pool } = require('pg');
const config = require('../config');

/**
 * Singleton pg.Pool for the whole process. Repositories import this;
 * nothing outside db/ should construct its own Pool or Client.
 */
const pool = new Pool({
  connectionString: config.db.url,
  // Fail fast rather than hang — the health-check needs a short timeout
  // (docs/architecture: "SELECT 1 ... with a short timeout").
  connectionTimeoutMillis: 2000,
});

/**
 * Cheap connectivity probe used by the health-check endpoint.
 * @returns {Promise<boolean>}
 */
async function checkConnection() {
  const result = await pool.query('SELECT 1');
  return result.rowCount === 1;
}

/**
 * Runs `fn(client)` inside a single Postgres transaction — BEGIN, then
 * COMMIT on success or ROLLBACK on any throw, always releasing the
 * client. This is how the golden path's "domain write + audit-ledger
 * append commit in the same transaction" rule is implemented: pass the
 * same `client` to every repository write and to `services/ledger`/
 * `services/security-events` inside one `withTransaction` call.
 *
 * Repository convention: write-capable repository functions take an
 * optional trailing `executor = pool` parameter — `pool` and a checked-
 * out `client` share the same `.query(text, params)` shape, so the same
 * function works standalone (`repo.fn(...)`) or inside a transaction
 * (`repo.fn(..., client)`).
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, checkConnection, withTransaction };
