'use strict';

const service = require('./evidence.service');
const { httpError } = require('../../errors');

async function getHealth(req, res, next) {
  try {
    res.status(200).json(await service.health());
  } catch (err) {
    next(err);
  }
}

function requireFile(req) {
  if (!req.file) throw httpError(400, 'VALIDATION_ERROR', 'A file is required.');
  return req.file;
}

async function register(req, res, next) {
  try {
    const result = await service.registerEvidence({ actorUser: req.user, file: requireFile(req), ...req.body });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function addArtifact(req, res, next) {
  try {
    const result = await service.addArtifact({ actorUser: req.user, evidenceId: req.params.id, file: requireFile(req) });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function seal(req, res, next) {
  try {
    res.status(200).json(await service.sealEvidence({ actorUser: req.user, evidenceId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    res.status(200).json(await service.verifyEvidence({ actorUser: req.user, evidenceId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    res.status(200).json(await service.getEvidence(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    res.status(200).json(await service.listEvidence(req.query));
  } catch (err) {
    next(err);
  }
}

async function listArtifacts(req, res, next) {
  try {
    res.status(200).json(await service.listArtifacts(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function downloadArtifact(req, res, next) {
  try {
    const { buffer, fileName, mimeType } = await service.downloadArtifact({
      actorUser: req.user,
      evidenceId: req.params.id,
      artifactId: req.params.artifactId,
      ipAddress: req.ip,
    });
    res
      .status(200)
      .set('Content-Type', mimeType)
      .set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
      .set('X-Integrity-Status', 'VERIFIED')
      .send(buffer);
  } catch (err) {
    next(err);
  }
}

async function requestTransfer(req, res, next) {
  try {
    const result = await service.requestTransfer({ actorUser: req.user, evidenceId: req.params.id, ...req.body });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function acceptTransfer(req, res, next) {
  try {
    const result = await service.acceptTransfer({
      actorUser: req.user,
      evidenceId: req.params.id,
      transferId: req.params.transferId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function rejectTransfer(req, res, next) {
  try {
    const result = await service.rejectTransfer({
      actorUser: req.user,
      evidenceId: req.params.id,
      transferId: req.params.transferId,
      reason: req.body.reason,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function startAnalysis(req, res, next) {
  try {
    res.status(200).json(await service.startAnalysis({ actorUser: req.user, evidenceId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function completeAnalysis(req, res, next) {
  try {
    res.status(200).json(await service.completeAnalysis({ actorUser: req.user, evidenceId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function returnEvidence(req, res, next) {
  try {
    res.status(200).json(await service.returnEvidence({ actorUser: req.user, evidenceId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function archive(req, res, next) {
  try {
    res.status(200).json(await service.archiveEvidence({ actorUser: req.user, evidenceId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function custodyTimeline(req, res, next) {
  try {
    res.status(200).json(await service.getCustodyTimeline(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function verifyCustody(req, res, next) {
  try {
    res.status(200).json(await service.verifyCustodyChain(req.params.id));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHealth,
  register,
  addArtifact,
  seal,
  verify,
  getById,
  list,
  listArtifacts,
  downloadArtifact,
  requestTransfer,
  acceptTransfer,
  rejectTransfer,
  startAnalysis,
  completeAnalysis,
  returnEvidence,
  archive,
  custodyTimeline,
  verifyCustody,
};
