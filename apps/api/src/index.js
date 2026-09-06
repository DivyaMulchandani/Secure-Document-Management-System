'use strict';

const config = require('./config');
const logger = require('./logger');
const buildApp = require('./app');
const { pool } = require('./db/pool');

const app = buildApp();

const server = app.listen(config.server.port, () => {
  logger.info(
    { port: config.server.port, nodeEnv: config.server.nodeEnv },
    'Secure DMS API listening',
  );
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'error during server close');
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (poolErr) {
      logger.error({ err: poolErr }, 'error closing db pool');
    }
    process.exit();
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
