'use strict';

const repository = require('./approval.repository');
const documentsRepository = require('../documents/documents.repository');
const { withTransaction } = require('../../db/pool');
const ledger = require('../../services/ledger');
const { httpError } = require('../../errors');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

// Documents in these statuses may enter review — matches the
// architecture's draft -> review -> approve/reject/revise -> sign ->
// final lifecycle; a document already UNDER_REVIEW, APPROVED, SIGNED,
// etc. needs its current chain resolved (or the document reset to
// DRAFT by a rejection) before another can start.
const SUBMITTABLE_STATUSES = ['DRAFT', 'ACTIVE'];

/**
 * Starts a sequential approval chain: `approverIds`, in order, each get
 * their own step; only the first is immediately actionable. Bound to
 * the document's CURRENT version at submission time (same "bound to a
 * version" pattern as document_signatures) — a version uploaded mid-
 * review doesn't retroactively change what's being reviewed.
 */
async function submitForApproval({ actorUser, documentId, approverIds }) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  if (!document.current_version_id) {
    throw httpError(409, 'CONFLICT', 'This document has no uploaded version to submit for approval.');
  }
  if (!SUBMITTABLE_STATUSES.includes(document.status)) {
    throw httpError(
      409,
      'ILLEGAL_TRANSITION',
      `Cannot submit a document with status ${document.status} for approval.`,
    );
  }

  const uniqueApproverIds = [...new Set(approverIds || [])];
  if (uniqueApproverIds.length === 0) {
    throw httpError(400, 'VALIDATION_ERROR', 'At least one approver is required.');
  }
  if (uniqueApproverIds.includes(actorUser.id)) {
    throw httpError(400, 'INVALID_APPROVER', 'You cannot be an approver on your own submission.');
  }

  return withTransaction(async (client) => {
    const request = await repository.insertRequest(
      { documentId, documentVersionId: document.current_version_id, requestedBy: actorUser.id },
      client,
    );
    for (let i = 0; i < uniqueApproverIds.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await repository.insertStep(
        { approvalRequestId: request.id, stepOrder: i, approverId: uniqueApproverIds[i] },
        client,
      );
    }
    await documentsRepository.updateDocumentStatus({ id: documentId, status: 'UNDER_REVIEW' }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'APPROVAL_REQUESTED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
      metadata: { approvalRequestId: request.id, approverIds: uniqueApproverIds },
    });
    const steps = await repository.listStepsForRequest(request.id, client);
    return { ...request, steps };
  });
}

async function listForDocument(documentId) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  const requests = await repository.listRequestsForDocument(documentId);
  return Promise.all(requests.map(async (r) => ({ ...r, steps: await repository.listStepsForRequest(r.id) })));
}

async function myInbox(actorUser) {
  return repository.findPendingStepsForApprover(actorUser.id);
}

async function loadActionableStepOrThrow(stepId, actorUser) {
  const step = await repository.findStepById(stepId);
  if (!step) throw httpError(404, 'NOT_FOUND', 'Approval step not found.');
  if (step.approver_id !== actorUser.id) {
    throw httpError(403, 'NOT_APPROVER', 'Only the assigned approver may decide this step.');
  }
  if (step.status !== 'PENDING') {
    throw httpError(409, 'CONFLICT', 'This step has already been decided.');
  }
  const request = await repository.findRequestById(step.approval_request_id);
  if (!request || request.status !== 'PENDING') {
    throw httpError(409, 'CONFLICT', 'This approval chain is no longer active.');
  }
  if (step.step_order !== request.current_step) {
    throw httpError(409, 'NOT_YOUR_TURN', 'An earlier approver has not decided on this chain yet.');
  }
  return { step, request };
}

/**
 * Decides one step. APPROVED on the last step in the chain closes the
 * whole request out APPROVED and moves the document to APPROVED (ready
 * to sign — see signatures.service.js — though signing itself doesn't
 * hard-require APPROVED; that stays a deliberate, additive path rather
 * than a breaking prerequisite on Sprint 5's already-shipped signing
 * flow). REJECTED/REVISION_REQUESTED both halt the chain immediately —
 * later steps never get a turn — and send the document back to DRAFT
 * for rework; a fresh submission starts an entirely new chain.
 */
async function decideStep({ actorUser, stepId, decision, comments }) {
  const { step, request } = await loadActionableStepOrThrow(stepId, actorUser);
  const document = await documentsRepository.findDocumentById(request.document_id);

  return withTransaction(async (client) => {
    const decidedStep = await repository.updateStepDecision(
      { id: step.id, status: decision, comments: comments || null },
      client,
    );

    if (decision === 'APPROVED') {
      const steps = await repository.listStepsForRequest(request.id, client);
      const isLastStep = request.current_step === steps.length - 1;
      if (isLastStep) {
        await repository.updateRequestStatus(
          { id: request.id, status: 'APPROVED', currentStep: request.current_step, completedAt: new Date() },
          client,
        );
        await documentsRepository.updateDocumentStatus({ id: request.document_id, status: 'APPROVED' }, client);
      } else {
        await repository.updateRequestStatus(
          { id: request.id, status: 'PENDING', currentStep: request.current_step + 1, completedAt: null },
          client,
        );
      }
    } else {
      await repository.updateRequestStatus(
        { id: request.id, status: decision, currentStep: request.current_step, completedAt: new Date() },
        client,
      );
      await documentsRepository.updateDocumentStatus({ id: request.document_id, status: 'DRAFT' }, client);
    }

    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'APPROVAL_STEP_DECIDED',
      resourceType: 'DOCUMENT',
      resourceId: request.document_id,
      caseId: document ? document.case_id : null,
      result: 'SUCCESS', // the decision operation succeeded regardless of which way it went — same convention as evidence's reject-transfer
      metadata: { approvalRequestId: request.id, stepId: step.id, decision, comments: comments || null },
    });

    return decidedStep;
  });
}

/**
 * Closes out a signed document as FINAL — the terminal state
 * documents.status has carried since Sprint 3 but nothing drove until
 * now. Deliberately gated on SIGNED rather than on having gone through
 * an approval chain at all — approval is an optional, additive path to
 * get there, not a hard prerequisite (see decideStep's doc comment).
 */
async function finalizeDocument({ actorUser, documentId }) {
  const document = await documentsRepository.findDocumentById(documentId);
  if (!document) throw httpError(404, 'NOT_FOUND', 'Document not found.');
  if (document.status !== 'SIGNED') {
    throw httpError(409, 'ILLEGAL_TRANSITION', 'A document must be SIGNED before it can be finalized.');
  }

  return withTransaction(async (client) => {
    const updated = await documentsRepository.updateDocumentStatus({ id: documentId, status: 'FINAL' }, client);
    await ledger.appendEvent(client, {
      actorUserId: actorUser.id,
      action: 'DOCUMENT_FINALIZED',
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      caseId: document.case_id,
      result: 'SUCCESS',
    });
    return updated;
  });
}

module.exports = { health, submitForApproval, listForDocument, myInbox, decideStep, finalizeDocument };
