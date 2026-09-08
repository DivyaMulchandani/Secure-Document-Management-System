'use strict';

const service = require('./permissions.service');

async function getHealth(req, res, next) {
  try {
    const result = await service.health();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function grant(req, res, next) {
  try {
    const result = await service.grantPermission(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listGrants(req, res, next) {
  try {
    const result = await service.listGrants(req.user, req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function revokeGrant(req, res, next) {
  try {
    const result = await service.revokeGrant(req.user, req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, grant, listGrants, revokeGrant };
