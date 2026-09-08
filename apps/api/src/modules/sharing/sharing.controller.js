'use strict';

const service = require('./sharing.service');

async function getHealth(req, res, next) {
  try {
    res.status(200).json(await service.health());
  } catch (err) {
    next(err);
  }
}

async function createShare(req, res, next) {
  try {
    const result = await service.createShare({
      actorUser: req.user,
      documentId: req.params.documentId,
      toUserId: req.body.toUserId,
      permission: req.body.permission,
      expiresInHours: req.body.expiresInHours,
      reason: req.body.reason,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listForDocument(req, res, next) {
  try {
    res.status(200).json(await service.listForDocument(req.params.documentId));
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    res.status(200).json(await service.listMine(req.user));
  } catch (err) {
    next(err);
  }
}

async function revokeShare(req, res, next) {
  try {
    const result = await service.revokeShare({
      actorUser: req.user,
      documentId: req.params.documentId,
      shareId: req.params.shareId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, createShare, listForDocument, listMine, revokeShare };
