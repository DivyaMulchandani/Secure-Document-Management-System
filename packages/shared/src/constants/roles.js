'use strict';

/**
 * The police organizational hierarchy (replaces the old flat 5-role
 * system — ADMINISTRATOR/INVESTIGATOR/FORENSIC_OFFICER/PROSECUTOR/
 * AUDITOR). Every unit in the chain of command gets exactly two roles:
 * `<LEVEL>_ADMIN` (manages that unit's accounts, creates the unit(s)
 * directly below it, and also does normal case/document work) and
 * `<LEVEL>_OFFICER` (rank-and-file staff of that unit — PSI/ASI/HC/
 * Constable etc. are a `users.rank` free-text label, not distinct
 * roles, so the role list doesn't explode further).
 *
 * `ROLE_LEVELS` is the single source of truth this whole module is
 * generated from — one row per unit type, not per role. `parentLevels`
 * encodes the creation hierarchy exactly as specified: a `_ADMIN` role
 * may create its own unit's `_OFFICER` plus the `_ADMIN` of every
 * *direct* child level, never skip-level. `STATION` is the one level
 * with two valid parents (SUBDIVISION in the rural/district branch,
 * DIVISION in the commissionerate branch).
 *
 * `tier` drives the permission-ceiling mapping in
 * services/permissions/index.js (see that file's ROLE_ACTION_CEILING
 * for the actual VIEW/EDIT/.../ARCHIVE mapping per tier):
 *   - OPERATIONAL: normal chain-of-command unit — ADMIN side gets the
 *     full "command" ceiling, OFFICER side gets a narrower "officer"
 *     ceiling (no SHARE/DELETE/ARCHIVE).
 *   - OVERSIGHT: Administration HQ / Internal Audit / IT — both ADMIN
 *     and OFFICER sides get the same narrow, read-mostly ceiling
 *     (deliberate exception to "admins do both": these units audit/
 *     support the system, they don't drive case work).
 *   - EXTERNAL: courts/prosecution/labs, outside the police chain of
 *     command — both sides get a review/sign-only ceiling, no
 *     edit/upload/share/delete/archive.
 *
 * Per-case collaborator roles (`CASE_ROLES` in case-roles.js — who's
 * assigned to *one specific* case, and how) are a completely separate,
 * unrelated concept and are NOT derived from this hierarchy.
 */
const ROLE_LEVELS = Object.freeze([
  { level: 'STATE_HQ', title: 'DGP', parentLevels: [], tier: 'OPERATIONAL' },
  { level: 'WING', title: 'Addl. DGP', parentLevels: ['STATE_HQ'], tier: 'OPERATIONAL' },
  { level: 'ADMINISTRATION_HQ', title: 'Administration HQ', parentLevels: ['STATE_HQ'], tier: 'OVERSIGHT' },
  { level: 'ADMINISTRATION_IT', title: 'Administration IT', parentLevels: ['ADMINISTRATION_HQ'], tier: 'OVERSIGHT' },
  { level: 'RANGE', title: 'IG', parentLevels: ['STATE_HQ'], tier: 'OPERATIONAL' },
  { level: 'DISTRICT', title: 'SP', parentLevels: ['RANGE'], tier: 'OPERATIONAL' },
  { level: 'SP_OFFICE', title: 'Addl. SP', parentLevels: ['DISTRICT'], tier: 'OPERATIONAL' },
  { level: 'SUBDIVISION', title: 'DySP', parentLevels: ['DISTRICT'], tier: 'OPERATIONAL' },
  { level: 'COMMISSIONERATE', title: 'CP', parentLevels: ['STATE_HQ'], tier: 'OPERATIONAL' },
  { level: 'BRANCH', title: 'ACP / officer-in-charge', parentLevels: ['COMMISSIONERATE'], tier: 'OPERATIONAL' },
  { level: 'SECTOR', title: 'DCP', parentLevels: ['COMMISSIONERATE'], tier: 'OPERATIONAL' },
  { level: 'ZONE', title: 'ACP', parentLevels: ['SECTOR'], tier: 'OPERATIONAL' },
  { level: 'DIVISION', title: 'Division', parentLevels: ['ZONE'], tier: 'OPERATIONAL' },
  { level: 'STATION', title: 'PI', parentLevels: ['SUBDIVISION', 'DIVISION'], tier: 'OPERATIONAL' },
  { level: 'CHOKI', title: 'PSI', parentLevels: ['STATION'], tier: 'OPERATIONAL' },
  { level: 'SRPF', title: 'SRPF', parentLevels: ['STATE_HQ'], tier: 'OPERATIONAL' },
  { level: 'SRPF_GROUP', title: 'SRPF Group', parentLevels: ['SRPF'], tier: 'OPERATIONAL' },
  { level: 'GRP', title: 'GRP Railway', parentLevels: ['STATE_HQ'], tier: 'OPERATIONAL' },
  { level: 'GRP_DIVISION', title: 'GRP Division', parentLevels: ['GRP'], tier: 'OPERATIONAL' },
  { level: 'MARINE', title: 'Marine Police', parentLevels: ['STATE_HQ'], tier: 'OPERATIONAL' },
  { level: 'MARINE_OUTPOST', title: 'Marine Outpost', parentLevels: ['MARINE'], tier: 'OPERATIONAL' },
  {
    level: 'EXTERNAL_UNIT',
    title: 'External (courts / prosecution / labs)',
    parentLevels: ['STATE_HQ'],
    tier: 'EXTERNAL',
  },
]);

const LEVEL_CODES = Object.freeze(ROLE_LEVELS.map((l) => l.level));

function adminRole(level) {
  return `${level}_ADMIN`;
}
function officerRole(level) {
  return `${level}_OFFICER`;
}

const ROLES = Object.freeze(
  ROLE_LEVELS.reduce((acc, { level }) => {
    acc[adminRole(level)] = adminRole(level);
    acc[officerRole(level)] = officerRole(level);
    return acc;
  }, {}),
);

const ROLE_LIST = Object.freeze(Object.values(ROLES));

function levelInfo(level) {
  return ROLE_LEVELS.find((l) => l.level === level) || null;
}

function childLevelsOf(level) {
  return ROLE_LEVELS.filter((l) => l.parentLevels.includes(level)).map((l) => l.level);
}

/**
 * @param {string} role e.g. ROLES.DISTRICT_ADMIN
 * @returns {{level: string, side: 'ADMIN'|'OFFICER', title: string}|null}
 */
function parseRole(role) {
  if (typeof role !== 'string') return null;
  const isAdmin = role.endsWith('_ADMIN');
  const isOfficer = role.endsWith('_OFFICER');
  if (!isAdmin && !isOfficer) return null;
  const level = isAdmin ? role.slice(0, -'_ADMIN'.length) : role.slice(0, -'_OFFICER'.length);
  const info = levelInfo(level);
  if (!info) return null;
  return { level, side: isAdmin ? 'ADMIN' : 'OFFICER', title: info.title };
}

/**
 * What a role may create through POST /users/invite — own-level
 * `_OFFICER` plus the `_ADMIN` of every direct child level. `_OFFICER`
 * roles create nothing (rank-and-file, not account managers).
 * @param {string} role
 * @returns {string[]}
 */
function createsRolesFor(role) {
  const parsed = parseRole(role);
  if (!parsed || parsed.side !== 'ADMIN') return [];
  return [officerRole(parsed.level), ...childLevelsOf(parsed.level).map(adminRole)];
}

/** @returns {'COMMAND'|'OFFICER'|'OVERSIGHT'|'EXTERNAL'|null} drives ROLE_ACTION_CEILING in services/permissions. */
function ceilingTierFor(role) {
  const parsed = parseRole(role);
  if (!parsed) return null;
  const info = levelInfo(parsed.level);
  if (info.tier === 'OPERATIONAL') return parsed.side === 'ADMIN' ? 'COMMAND' : 'OFFICER';
  return info.tier; // OVERSIGHT or EXTERNAL — same ceiling for both sides
}

function humanizeLevel(level) {
  return level
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Human display label, e.g. "STATE_HQ_ADMIN" -> "DGP", "STATION_OFFICER" -> "Station officer" (actual rank is the free-text users.rank field). */
function roleTitle(role) {
  const parsed = parseRole(role);
  if (!parsed) return role;
  return parsed.side === 'ADMIN' ? parsed.title : `${humanizeLevel(parsed.level)} officer`;
}

/**
 * Convenience bundle for callers that want everything about a role at
 * once (frontend pickers, invite-authority checks).
 * @param {string} role
 * @returns {{level: string, side: 'ADMIN'|'OFFICER', title: string, createsRoles: string[], ceilingTier: string}|null}
 */
function roleHierarchyFor(role) {
  const parsed = parseRole(role);
  if (!parsed) return null;
  return { ...parsed, createsRoles: createsRolesFor(role), ceilingTier: ceilingTierFor(role) };
}

// Oversight tier's top two units — read the full ledger, reopen closed
// cases, see every case regardless of membership. STATE_HQ_ADMIN is the
// apex of the whole hierarchy so it's included even though its own tier
// is OPERATIONAL.
const AUDIT_ROLES = Object.freeze(['STATE_HQ_ADMIN', 'ADMINISTRATION_HQ_ADMIN', 'ADMINISTRATION_HQ_OFFICER']);
const TOP_OVERSIGHT_ROLES = AUDIT_ROLES;

// Everyone who runs an actual investigating/operational unit may open a
// case — i.e. every role EXCEPT the oversight tier (Administration HQ/IT)
// and the external tier (courts/prosecution/labs, outside the chain of
// command).
const CASE_CREATOR_ROLES = Object.freeze(
  ROLE_LIST.filter((role) => {
    const tier = ceilingTierFor(role);
    return tier === 'COMMAND' || tier === 'OFFICER';
  }),
);

module.exports = {
  ROLES,
  ROLE_LIST,
  ROLE_LEVELS,
  LEVEL_CODES,
  parseRole,
  createsRolesFor,
  ceilingTierFor,
  roleTitle,
  roleHierarchyFor,
  AUDIT_ROLES,
  TOP_OVERSIGHT_ROLES,
  CASE_CREATOR_ROLES,
};
