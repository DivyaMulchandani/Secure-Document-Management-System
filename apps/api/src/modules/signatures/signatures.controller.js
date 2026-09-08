'use strict';

const service = require('./signatures.service');
const { httpError } = require('../../errors');

async function getHealth(req, res, next) {
  try {
    res.status(200).json(await service.health());
  } catch (err) {
    next(err);
  }
}

async function generateKey(req, res, next) {
  try {
    res.status(201).json(await service.generateOrRotateKey({ actorUser: req.user }));
  } catch (err) {
    next(err);
  }
}

async function getMyKey(req, res, next) {
  try {
    const key = await service.getMyKey({ actorUser: req.user });
    if (!key) throw httpError(404, 'NOT_FOUND', 'No active signing key yet — generate one first.');
    res.status(200).json(key);
  } catch (err) {
    next(err);
  }
}

async function selfSign(req, res, next) {
  try {
    const result = await service.selfSign({
      actorUser: req.user,
      documentId: req.params.documentId,
      reason: req.body.reason,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function requestSignature(req, res, next) {
  try {
    const result = await service.requestSignature({
      actorUser: req.user,
      documentId: req.params.documentId,
      toUserId: req.body.toUserId,
      reason: req.body.reason,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function fulfillPending(req, res, next) {
  try {
    res.status(200).json(await service.fulfillPending({ actorUser: req.user, signatureId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function declinePending(req, res, next) {
  try {
    res.status(200).json(
      await service.declinePending({ actorUser: req.user, signatureId: req.params.id, reason: req.body.reason }),
    );
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

async function myQueue(req, res, next) {
  try {
    res.status(200).json(await service.myQueue(req.user));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHealth,
  generateKey,
  getMyKey,
  selfSign,
  requestSignature,
  fulfillPending,
  declinePending,
  listForDocument,
  myQueue,
};
