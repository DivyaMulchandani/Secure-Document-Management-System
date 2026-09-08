'use strict';

const { pool } = require('../../db/pool');
const { ROLES, PERMISSIONS, CASE_ROLES } = require('@secure-dms/shared');

/**
 * Real implementation of the three-layer access model (docs/architecture
 * — "Access model" / "Fine-Grained Access Control"). This is what
 * middleware/require-permission.js calls on every guarded route.
 *
 * Layer 1 — RBAC role ceiling: a static map of "what can this GLOBAL
 * role ever do, at most" (see ROLE_ACTION_CEILING below). This is the
 * architecture's baseline: e.g. an Auditor can never EDIT, no matter
 * what case they're a member of.
 *
 * Layer 2 — Case scope: case_members says which cases are in reach at
 * all; case_role further narrows what a member can do ON that case
 * (see CASE_ROLE_ACTIONS below). For a resource that BELONGS TO a case
 * (e.g. DOCUMENT) rather than being a case itself, the case-scope check
 * resolves the resource's owning case_id first (see
 * resolveOwningCaseId) and checks case_members against THAT — a
 * document's case-scope access is exactly its parent case's access.
 * Deliberately NO administrator bypass —
 * an Administrator who isn't a case member has no more case-content
 * access than anyone else who isn't (matches the architecture's Role
 * Capability Matrix, where Administrator's ceiling on case/document
 * content is "scoped/conditional", not "full" — full/unconditional only
 * applies to org-management actions, which are gated separately via
 * middleware/require-role.js, not this engine).
 *
 * Layer 3 — Resource grant: resource_permissions is an explicit,
 * independent exception on ONE resource (e.g. a 72h VIEW grant), and is
 * checked regardless of case membership.
 *
 * can() allows when: (role ceiling permits the action) AND
 *   (case-scope permits it OR an explicit resource grant permits it).
 *
 * NOTE: the exact case_role -> allowed-actions mapping and the
 * role -> ceiling mapping are judgment calls extrapolated from the
 * architecture's general Role Capability Matrix (which doesn't give a
 * resource-type-by-resource-type breakdown) — documented inline, easy
 * to retune as later sprints add document/evidence resource types.
 */

const ROLE_ACTION_CEILING = Object.freeze({
  [ROLES.ADMINISTRATOR]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.EDIT,
    PERMISSIONS.UPLOAD,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.SHARE,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
    PERMISSIONS.DELETE,
    PERMISSIONS.ARCHIVE,
  ],
  [ROLES.INVESTIGATOR]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.EDIT,
    PERMISSIONS.UPLOAD,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.SHARE,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
    PERMISSIONS.DELETE,
    PERMISSIONS.ARCHIVE,
  ],
  [ROLES.FORENSIC_OFFICER]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.EDIT, // matrix: "Register/transfer evidence ⬤ (receive/analyse)" — seal/verify/analyze/return are EDIT-class evidence-state changes
    PERMISSIONS.UPLOAD, // conditional in the matrix ("forensic reports" only) — not enforced by document_type this sprint, see CASE_ROLE_ACTIONS.FORENSIC note
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
  ],
  [ROLES.PROSECUTOR]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
  ],
  // Least-privilege, read-only oversight — matrix: "Auditor may VERIFY, never EDIT".
  [ROLES.AUDITOR]: [PERMISSIONS.VIEW, PERMISSIONS.VERIFY, PERMISSIONS.DOWNLOAD],
});

// PERMISSIONS.VERIFY is deliberately in EVERY row below (not just the
// global ROLE_ACTION_CEILING) — the matrix's "Verify integrity /
// signatures / custody" row is unconditionally full (⬤) for ALL five
// roles, so case-scope must never be the layer that blocks it. Found by
// evidence.routes.js's /verify and /custody/verify endpoints, the first
// routes to actually gate on PERMISSIONS.VERIFY — documents' integrity
// re-check happens as a DOWNLOAD side effect, never as its own guarded
// action, so this gap was latent until this sprint.
//
// PERMISSIONS.SIGN mirrors ROLE_ACTION_CEILING's own SIGN grants
// (INVESTIGATOR/FORENSIC_OFFICER/PROSECUTOR/ADMINISTRATOR, not AUDITOR)
// — same latent-gap shape as VERIFY above, found by signatures.routes.js
// (Sprint 5), the first routes to gate on PERMISSIONS.SIGN. VIEWER is
// deliberately excluded (read-only case role; matrix has no viewer-signs
// capability).
const CASE_ROLE_ACTIONS = Object.freeze({
  [CASE_ROLES.OWNER]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.EDIT,
    PERMISSIONS.UPLOAD,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.SHARE,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
    PERMISSIONS.ARCHIVE,
    PERMISSIONS.DELETE,
  ],
  [CASE_ROLES.INVESTIGATOR]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.EDIT,
    PERMISSIONS.UPLOAD,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.SHARE,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
  ],
  // Matrix: forensic officers may upload, but only forensic-report-type
  // documents — this sprint doesn't refine by document_type_id, so
  // UPLOAD is allowed case-wide for a FORENSIC member; tightening to
  // "only when document_type_id = FORENSIC_REPORT" is a reasonable
  // later refinement, not a correctness bug (it's strictly more
  // permissive than the matrix, never less).
  [CASE_ROLES.FORENSIC]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.EDIT, // register/seal/verify/transfer/analyze/return evidence — see ROLE_ACTION_CEILING.FORENSIC_OFFICER note
    PERMISSIONS.UPLOAD,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
  ],
  [CASE_ROLES.PROSECUTOR]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.DOWNLOAD,
    PERMISSIONS.COMMENT,
    PERMISSIONS.SIGN,
    PERMISSIONS.VERIFY,
  ],
  [CASE_ROLES.VIEWER]: [PERMISSIONS.VIEW, PERMISSIONS.DOWNLOAD, PERMISSIONS.VERIFY],
});

/**
 * @param {{id: string, roles: string[]}|null} user
 * @param {string} action a permissions.code value, e.g. PERMISSIONS.EDIT
 * @param {{type: 'CASE'|'DOCUMENT'|'EVIDENCE'|'REPORT', id: string}} resource
 * @returns {Promise<boolean>}
 */
async function can(user, action, resource) {
  if (!user || !resource || !resource.id) return false;

  const roleAllows = (user.roles || []).some((role) =>
    (ROLE_ACTION_CEILING[role] || []).includes(action),
  );
  if (!roleAllows) return false;

  const caseId = await resolveOwningCaseId(resource.type, resource.id);
  if (caseId) {
    const caseScopeAllows = await checkCaseScope(user.id, caseId, action);
    if (caseScopeAllows) return true;
  }

  return checkResourceGrant(user.id, resource.type, resource.id, action);
}

/**
 * @param {string} resourceType
 * @param {string} resourceId
 * @returns {Promise<string|null>} the case_id that "owns" this
 *   resource's case-scope, or null if the resource type isn't
 *   case-scoped (or a resolver for it doesn't exist yet — REPORT falls
 *   through to null until its module lands, which is safe: it just
 *   means case-scope contributes nothing and only an explicit
 *   resource_permissions grant can allow access to it).
 */
async function resolveOwningCaseId(resourceType, resourceId) {
  if (resourceType === 'CASE') return resourceId;
  if (resourceType === 'DOCUMENT') {
    const { rows } = await pool.query('SELECT case_id FROM documents WHERE id = $1', [resourceId]);
    return rows[0] ? rows[0].case_id : null;
  }
  if (resourceType === 'EVIDENCE') {
    const { rows } = await pool.query('SELECT case_id FROM evidence WHERE id = $1', [resourceId]);
    return rows[0] ? rows[0].case_id : null;
  }
  return null;
}

async function checkCaseScope(userId, caseId, action) {
  const { rows } = await pool.query(
    `SELECT case_role FROM case_members
     WHERE case_id = $1 AND user_id = $2 AND revoked_at IS NULL
     LIMIT 1`,
    [caseId, userId],
  );
  if (rows.length === 0) return false;
  return (CASE_ROLE_ACTIONS[rows[0].case_role] || []).includes(action);
}

async function checkResourceGrant(userId, resourceType, resourceId, action) {
  const { rows } = await pool.query(
    `SELECT 1 FROM resource_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.resource_type = $1 AND rp.resource_id = $2 AND rp.user_id = $3
       AND p.code = $4
       AND rp.revoked_at IS NULL
       AND (rp.expires_at IS NULL OR rp.expires_at > now())
     LIMIT 1`,
    [resourceType, resourceId, userId, action],
  );
  return rows.length > 0;
}

/**
 * True if the given user is an active member of the case (any role).
 * Used by the cases module for membership-existence checks that aren't
 * tied to one specific permission (e.g. "is this user on the case at
 * all" for listing).
 */
async function isCaseMember(userId, caseId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM case_members WHERE case_id = $1 AND user_id = $2 AND revoked_at IS NULL LIMIT 1',
    [caseId, userId],
  );
  return rows.length > 0;
}

module.exports = { can, isCaseMember, ROLE_ACTION_CEILING, CASE_ROLE_ACTIONS };
