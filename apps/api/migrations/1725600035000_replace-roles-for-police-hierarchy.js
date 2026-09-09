'use strict';

const { ROLE_LEVELS, roleTitle } = require('@secure-dms/shared');

exports.shorthands = undefined;

/**
 * Replaces the old flat 5-role system (ADMINISTRATOR/INVESTIGATOR/
 * FORENSIC_OFFICER/PROSECUTOR/AUDITOR) with the police organizational
 * hierarchy (44 roles — 2 per unit level, see
 * packages/shared/src/constants/roles.js's ROLE_LEVELS, the single
 * source of truth this migration reads from rather than duplicating the
 * role list by hand).
 *
 * Also seeds exactly ONE `departments` row — the State HQ root — and
 * re-points the existing bootstrap admin (created by
 * 1725600013000_seed-bootstrap-admin.js under the now-deleted
 * ADMINISTRATOR role) onto the new STATE_HQ_ADMIN role, attached to
 * that root department. Every other unit (Ranges, Districts, SRPF
 * Groups, ...) is deliberately NOT fabricated here — real admins create
 * them on demand via POST /users/departments as they invite real
 * subordinates (see users.service.js's inviteUser), rather than this
 * migration guessing at a pretend org chart.
 *
 * Async (uses pgm.db.query/select, the immediate-execution API) for the
 * same reason as the original bootstrap-admin migration: needs to read
 * back generated ids between statements. Reads BOOTSTRAP_ADMIN_USERNAME
 * directly from process.env (not via ../src/config), same rationale —
 * decoupled from config's NODE_ENV=test short-circuit.
 *
 * DESTRUCTIVE for any pre-existing dev/demo users under the old 5 roles
 * (their user_roles row is cascade-deleted with the old role) — this is
 * a deliberate, flagged tradeoff for a hackathon dev database, not
 * something to run against real production data unannounced.
 */
exports.up = async (pgm) => {
  const { BOOTSTRAP_ADMIN_USERNAME } = process.env;
  if (!BOOTSTRAP_ADMIN_USERNAME) {
    throw new Error('Set BOOTSTRAP_ADMIN_USERNAME before running migrate:up.');
  }

  // 1. Seed the 44 new roles.
  for (const { level, title } of ROLE_LEVELS) {
    const adminName = `${level}_ADMIN`;
    const officerName = `${level}_OFFICER`;
    // eslint-disable-next-line no-await-in-loop
    await pgm.db.query(
      `INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
      [adminName, `${title} — manages ${level.replace(/_/g, ' ').toLowerCase()}-level accounts and case work.`],
    );
    // eslint-disable-next-line no-await-in-loop
    await pgm.db.query(
      `INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
      [officerName, `${roleTitle(officerName)} — rank-and-file staff of a ${level.replace(/_/g, ' ').toLowerCase()} unit.`],
    );
  }

  // 2. Seed the one root department.
  await pgm.db.query(
    `INSERT INTO departments (name, code, unit_type, parent_department_id)
     VALUES ('State Headquarters', 'STATE-HQ-ROOT', 'STATE_HQ', NULL)
     ON CONFLICT (code) DO NOTHING`,
  );
  const [{ id: rootDepartmentId }] = await pgm.db.select(
    "SELECT id FROM departments WHERE code = 'STATE-HQ-ROOT'",
  );

  // 3. Re-point the bootstrap admin onto STATE_HQ_ADMIN + the root department
  // (before dropping the old roles below, while its user_roles row still
  // resolves cleanly).
  const bootstrapUserRows = await pgm.db.select('SELECT id FROM users WHERE username = $1', [
    BOOTSTRAP_ADMIN_USERNAME,
  ]);
  if (bootstrapUserRows.length > 0) {
    const [{ id: bootstrapUserId }] = bootstrapUserRows;
    await pgm.db.query(`UPDATE users SET department_id = $1, rank = 'DGP' WHERE id = $2`, [
      rootDepartmentId,
      bootstrapUserId,
    ]);
  }

  // 4. Drop the old roles (cascades user_roles for every user still
  // holding one, including — for a moment — the bootstrap admin).
  // user_invitations.role_id is ON DELETE RESTRICT (an invitation must
  // always resolve to a real role), so any pending/accepted/expired
  // invitations against the old roles are cleared first — dev/demo data
  // only, same destructive-rollout tradeoff flagged in the plan.
  await pgm.db.query(
    `DELETE FROM user_invitations WHERE role_id IN (
       SELECT id FROM roles WHERE name IN ('ADMINISTRATOR','INVESTIGATOR','FORENSIC_OFFICER','PROSECUTOR','AUDITOR')
     )`,
  );
  await pgm.db.query(
    `DELETE FROM roles WHERE name IN ('ADMINISTRATOR','INVESTIGATOR','FORENSIC_OFFICER','PROSECUTOR','AUDITOR')`,
  );

  if (bootstrapUserRows.length > 0) {
    const [{ id: bootstrapUserId }] = bootstrapUserRows;
    const [{ id: stateHqAdminRoleId }] = await pgm.db.select(
      "SELECT id FROM roles WHERE name = 'STATE_HQ_ADMIN'",
    );
    await pgm.db.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [bootstrapUserId, stateHqAdminRoleId],
    );
  }
  // else: no bootstrap user exists yet (this migration ran before
  // 1725600013000 somehow, or BOOTSTRAP_ADMIN_USERNAME changed) — old
  // roles are still dropped above so the roles table only ever holds one
  // system.
};

exports.down = async (pgm) => {
  await pgm.db.query(
    `DELETE FROM roles WHERE name IN (${ROLE_LEVELS.flatMap((l) => [`'${l.level}_ADMIN'`, `'${l.level}_OFFICER'`]).join(',')})`,
  );
  await pgm.db.query(`DELETE FROM departments WHERE code = 'STATE-HQ-ROOT'`);
};
