'use strict';

const service = require('./documents.service');

/**
 * Thin HTTP layer only — no SQL, no business logic. Proves the 5-file
 * module pattern end to end; real endpoints for documents are added
 * alongside/in place of this stub in later sprints.
 */
async function getHealth(req, res, next) {
  try {
    const result = await service.health();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth };
