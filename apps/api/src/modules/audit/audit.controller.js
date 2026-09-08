'use strict';

const service = require('./audit.service');

async function getHealth(req, res, next) {
  try {
    const result = await service.health();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const result = await service.listEvents(req.user, req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    const result = await service.verifyChain();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function exportCsv(req, res, next) {
  try {
    const csv = await service.exportCsv(req.user, req.query);
    res.status(200).set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="audit-events.csv"').send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, list, verify, exportCsv };
