'use strict';

/**
 * Case-level membership roles (case_members.case_role) — distinct from
 * the global RBAC roles in roles.js. A user's global role says what
 * they can ever do; their case_role says what they can do on THIS
 * specific case once they're a member of it.
 * @see docs/architecture — "Domain · Cases" (case_members ER diagram)
 */
const CASE_ROLES = Object.freeze({
  OWNER: 'OWNER',
  INVESTIGATOR: 'INVESTIGATOR',
  FORENSIC: 'FORENSIC',
  PROSECUTOR: 'PROSECUTOR',
  VIEWER: 'VIEWER',
});

const CASE_ROLE_LIST = Object.freeze(Object.values(CASE_ROLES));

module.exports = { CASE_ROLES, CASE_ROLE_LIST };
