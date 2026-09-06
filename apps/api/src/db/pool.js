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

module.exports = { pool, checkConnection };
