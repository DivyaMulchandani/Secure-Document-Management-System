'use strict';

const service = require('./cases.service');

async function getHealth(req, res, next) {
  try {
    const result = await service.health();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const result = await service.createCase({ creatorUserId: req.user.id, ...req.body });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const result = await service.listCases(req.user, req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const result = await service.getCase(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const result = await service.updateCase({ actorUserId: req.user.id, id: req.params.id, ...req.body });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const result = await service.updateCaseStatus({
      actorUserId: req.user.id,
      actorRoles: req.user.roles,
      id: req.params.id,
      status: req.body.status,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function addMember(req, res, next) {
  try {
    const result = await service.addMember({
      actorUserId: req.user.id,
      caseId: req.params.id,
      userId: req.body.userId,
      caseRole: req.body.caseRole,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listMembers(req, res, next) {
  try {
    const result = await service.listMembers(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const result = await service.removeMember({
      actorUserId: req.user.id,
      caseId: req.params.id,
      userId: req.params.userId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHealth,
  create,
  list,
  getById,
  update,
  updateStatus,
  addMember,
  listMembers,
  removeMember,
};
