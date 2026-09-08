'use strict';

const service = require('./documents.service');
const { httpError } = require('../../errors');

async function getHealth(req, res, next) {
  try {
    const result = await service.health();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function listTypes(req, res, next) {
  try {
    const result = await service.listDocumentTypes();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

function requireFile(req) {
  if (!req.file) throw httpError(400, 'FILE_REQUIRED', 'A file is required.');
  return req.file;
}

async function create(req, res, next) {
  try {
    const file = requireFile(req);
    const result = await service.uploadNewDocument({
      actorUser: req.user,
      caseId: req.body.caseId,
      documentTypeId: req.body.documentTypeId,
      title: req.body.title,
      description: req.body.description,
      file,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function addVersion(req, res, next) {
  try {
    const file = requireFile(req);
    const result = await service.uploadNewVersion({
      actorUser: req.user,
      documentId: req.params.id,
      file,
      changeNote: req.body.changeNote,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function restoreVersion(req, res, next) {
  try {
    const result = await service.restoreVersion({
      actorUser: req.user,
      documentId: req.params.id,
      versionId: req.params.versionId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const result = await service.getDocument({ documentId: req.params.id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const result = await service.listDocuments(req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function listVersions(req, res, next) {
  try {
    const result = await service.listVersions({ documentId: req.params.id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function downloadCurrent(req, res, next) {
  try {
    const result = await service.downloadVersion({
      actorUser: req.user,
      documentId: req.params.id,
      ipAddress: req.ip,
    });
    sendFile(res, result);
  } catch (err) {
    next(err);
  }
}

async function downloadVersion(req, res, next) {
  try {
    const result = await service.downloadVersion({
      actorUser: req.user,
      documentId: req.params.id,
      versionId: req.params.versionId,
      ipAddress: req.ip,
    });
    sendFile(res, result);
  } catch (err) {
    next(err);
  }
}

function sendFile(res, { buffer, fileName, mimeType }) {
  res
    .status(200)
    .set('Content-Type', mimeType)
    .set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
    .set('X-Integrity-Status', 'VERIFIED')
    .send(buffer);
}

async function update(req, res, next) {
  try {
    const result = await service.updateDocument({ actorUser: req.user, documentId: req.params.id, ...req.body });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await service.deleteDocument({ actorUser: req.user, documentId: req.params.id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function addComment(req, res, next) {
  try {
    const result = await service.addComment({ actorUser: req.user, documentId: req.params.id, body: req.body.body });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listComments(req, res, next) {
  try {
    const result = await service.listComments({ documentId: req.params.id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHealth,
  listTypes,
  create,
  addVersion,
  restoreVersion,
  getById,
  list,
  listVersions,
  downloadCurrent,
  downloadVersion,
  update,
  remove,
  addComment,
  listComments,
};
