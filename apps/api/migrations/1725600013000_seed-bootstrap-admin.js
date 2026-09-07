'use strict';

const { hashPassword } = require('../src/services/crypto');

exports.shorthands = undefined;

/**
 * The only async migration in the codebase — solves the chicken-and-egg
 * problem of "inviting a user requires an existing Administrator, but
 * nothing has ever seeded one." Reads BOOTSTRAP_ADMIN_USERNAME/EMAIL/
 * PASSWORD directly from process.env (NOT via ../src/config) so this
 * migration stays decoupled from that module's NODE_ENV=test short-circuit
 * and its own fail-fast process.exit(1) side effect — these three vars
 * must be present in whatever shell/container runs `migrate:up`.
 *
 * require('../src/services/crypto') is safe here: that module has no
 * dependency on ../../config (scrypt params are hardcoded constants), so
 * requiring it from a migration can't trigger config's fail-fast exit.
 *
 * Fully idempotent (ON CONFLICT DO NOTHING both places) — safe to re-run.
 */
exports.up = async (pgm) => {
  const { BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD } = process.env;

  if (!BOOTSTRAP_ADMIN_USERNAME || !BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_PASSWORD) {
    throw new Error(
      'Set BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before running migrate:up.',
    );
  }

  const passwordHash = await hashPassword(BOOTSTRAP_ADMIN_PASSWORD);

  await pgm.db.query(
    `INSERT INTO users (username, email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'Bootstrap Administrator', 'ACTIVE')
     ON CONFLICT (username) DO NOTHING`,
    [BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL, passwordHash],
  );

  const [{ id: userId }] = await pgm.db.select('SELECT id FROM users WHERE username = $1', [
    BOOTSTRAP_ADMIN_USERNAME,
  ]);
  const [{ id: roleId }] = await pgm.db.select("SELECT id FROM roles WHERE name = 'ADMINISTRATOR'");

  await pgm.db.query(
    'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, roleId],
  );
};

/**
 * Best-effort cleanup for local dev only — do not rely on this in CI
 * (CI always creates a fresh database).
 */
exports.down = async (pgm) => {
  const { BOOTSTRAP_ADMIN_USERNAME } = process.env;
  if (!BOOTSTRAP_ADMIN_USERNAME) return;
  await pgm.db.query('DELETE FROM users WHERE username = $1', [BOOTSTRAP_ADMIN_USERNAME]);
};
