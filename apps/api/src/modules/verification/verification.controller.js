'use strict';

const service = require('./verification.service');

async function getHealth(req, res, next) {
  try {
    res.status(200).json(await service.health());
  } catch (err) {
    next(err);
  }
}

async function verifyDocument(req, res, next) {
  try {
    const result = await service.verifyDocumentInternal({
      actorUser: req.user,
      documentId: req.params.documentId,
      ipAddress: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function listRecords(req, res, next) {
  try {
    res.status(200).json(await service.listRecordsForDocument(req.params.documentId));
  } catch (err) {
    next(err);
  }
}

async function verifyPublic(req, res, next) {
  try {
    const result = await service.verifyByCode({ code: req.params.code, ipAddress: req.ip });
    res.status(result.status === 'NOT_FOUND' ? 404 : 200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, verifyDocument, listRecords, verifyPublic };
