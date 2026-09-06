'use strict';

/**
 * STUB — Sprint 0.
 *
 * Real implementation stores OCR text + embeddings (pgvector) and
 * returns only permission-filtered hits, backing full-text/semantic
 * search and the permission-aware RAG feature. No-op for now.
 */
async function indexChunk(/* documentVersionId, caseId, chunk */) {
  // no-op — nothing to index yet
}

async function search(/* query, permittedScope */) {
  return [];
}

module.exports = { indexChunk, search };
