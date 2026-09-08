'use strict';

const service = require('./approval.service');

async function getHealth(req, res, next) {
  try {
    res.status(200).json(await service.health());
  } catch (err) {
    next(err);
  }
}

async function submitForApproval(req, res, next) {
  try {
    const result = await service.submitForApproval({
      actorUser: req.user,
      documentId: req.params.documentId,
      approverIds: req.body.approverIds,
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

async function myInbox(req, res, next) {
  try {
    res.status(200).json(await service.myInbox(req.user));
  } catch (err) {
    next(err);
  }
}

async function decideStep(req, res, next) {
  try {
    const result = await service.decideStep({
      actorUser: req.user,
      stepId: req.params.stepId,
      decision: req.body.decision,
      comments: req.body.comments,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function finalizeDocument(req, res, next) {
  try {
    res.status(200).json(await service.finalizeDocument({ actorUser: req.user, documentId: req.params.documentId }));
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, submitForApproval, listForDocument, myInbox, decideStep, finalizeDocument };
