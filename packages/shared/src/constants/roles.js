'use strict';

/**
 * The five internal RBAC roles. Mirrors the `roles` table seed data
 * (apps/api/migrations/*_seed-roles.js) — keep in sync manually.
 * @see docs/architecture — "Actors & roles"
 */
const ROLES = Object.freeze({
  ADMINISTRATOR: 'ADMINISTRATOR',
  INVESTIGATOR: 'INVESTIGATOR',
  FORENSIC_OFFICER: 'FORENSIC_OFFICER',
  PROSECUTOR: 'PROSECUTOR',
  AUDITOR: 'AUDITOR',
});

const ROLE_LIST = Object.freeze(Object.values(ROLES));

module.exports = { ROLES, ROLE_LIST };
