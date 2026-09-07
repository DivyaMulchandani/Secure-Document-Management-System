'use strict';

const service = require('./users.service');

/**
 * Thin HTTP layer only — no SQL, no business logic. Proves the 5-file
 * module pattern end to end; real endpoints for users are added
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

async function invite(req, res, next) {
  try {
    const result = await service.inviteUser({ invitedByUserId: req.user.id, ...req.body });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function previewActivation(req, res, next) {
  try {
    const result = await service.previewInvitation(req.params.token);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const result = await service.activateAccount({ token: req.params.token, ...req.body });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const result = await service.listUsers(req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const result = await service.getUser(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const result = await service.updateUserStatus({
      adminId: req.user.id,
      targetId: req.params.id,
      status: req.body.status,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateRoles(req, res, next) {
  try {
    const result = await service.updateUserRoles({
      adminId: req.user.id,
      targetId: req.params.id,
      roleNames: req.body.roleNames,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function listDepartments(req, res, next) {
  try {
    const result = await service.listDepartments();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function createDepartment(req, res, next) {
  try {
    const result = await service.createDepartment(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHealth,
  invite,
  previewActivation,
  activate,
  list,
  getById,
  updateStatus,
  updateRoles,
  listDepartments,
  createDepartment,
};
