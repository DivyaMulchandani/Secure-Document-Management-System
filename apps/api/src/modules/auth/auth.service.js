'use strict';

const repository = require('./auth.repository');
const { withTransaction } = require('../../db/pool');
const jwtService = require('../../services/jwt');
const cryptoService = require('../../services/crypto');
const mfaService = require('../../services/mfa');
const ledger = require('../../services/ledger');
const securityEvents = require('../../services/security-events');
const config = require('../../config');
const { httpError } = require('../../errors');

async function health() {
  const result = await repository.healthCheck();
  return { module: result.module, status: 'ok' };
}

// --- login / refresh / lockout (docs/architecture "Feature flow · Authentication & session") ---

/**
 * @param {{username: string, password: string, otp?: string, ipAddress?: string, userAgent?: string}} params
 * @returns {Promise<{accessToken: string, refreshToken: string, user: object}>}
 */
async function login({ username, password, otp, ipAddress = null, userAgent = null }) {
  const user = await repository.findUserByUsername(username);

  if (!user) {
    await repository.insertLoginAttempt({ usernameTried: username, ipAddress, success: false });
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  if (user.status === 'LOCKED') {
    await repository.insertLoginAttempt({
      userId: user.id,
      usernameTried: username,
      ipAddress,
      success: false,
    });
    throw httpError(403, 'ACCOUNT_LOCKED', 'This account is locked. Contact an administrator.');
  }

  const passwordOk = await cryptoService.verifyPassword(password, user.password_hash);

  // Any failure (bad password OR bad/missing OTP when MFA is enabled)
  // counts toward the lockout threshold uniformly — never reveals which
  // factor actually failed.
  let mfaOk = true;
  if (passwordOk && user.mfa_enabled) {
    if (!otp) {
      mfaOk = false;
    } else {
      const credential = await repository.findVerifiedMfaCredential(user.id);
      mfaOk = credential ? mfaService.verifyToken(credential.secret, otp) : false;
    }
  }

  if (!passwordOk || !mfaOk) {
    const { locked } = await withTransaction(async (client) => {
      const newCount = await repository.incrementFailedLoginCount(user.id, client);
      await repository.insertLoginAttempt(
        { userId: user.id, usernameTried: username, ipAddress, success: false },
        client,
      );
      await ledger.appendEvent(client, {
        actorUserId: user.id,
        action: 'LOGIN_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        result: 'FAILURE',
        ipAddress,
        device: userAgent,
      });

      if (newCount >= config.auth.lockoutThreshold) {
        await repository.setUserStatus(user.id, 'LOCKED', client);
        await securityEvents.raise(client, {
          eventType: 'MULTIPLE_FAILED_LOGIN',
          severity: 'HIGH',
          userId: user.id,
          resourceType: 'user',
          resourceId: user.id,
          description: `Account locked after ${newCount} consecutive failed login attempts.`,
        });
        return { locked: true };
      }
      return { locked: false };
    });

    if (locked) throw httpError(403, 'ACCOUNT_LOCKED', 'This account is locked. Contact an administrator.');
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  const { raw: refreshToken, hash: refreshTokenHash } = jwtService.generateOpaqueToken();
  const expiresAt = new Date(Date.now() + jwtService.parseDuration(config.jwt.refreshTtl));

  const roles = await withTransaction(async (client) => {
    await repository.resetFailedLoginCount(user.id, client);
    await repository.setLastLoginAt(user.id, client);
    const session = await repository.insertAuthSession(
      { userId: user.id, refreshTokenHash, expiresAt, ipAddress, userAgent },
      client,
    );
    await repository.insertLoginAttempt(
      { userId: user.id, usernameTried: username, ipAddress, success: true },
      client,
    );
    const roleNames = await repository.findRoleNamesForUser(user.id, client);
    await ledger.appendEvent(client, {
      actorUserId: user.id,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      ipAddress,
      sessionId: session.id,
      device: userAgent,
    });
    return roleNames;
  });

  const accessToken = jwtService.signAccessToken({ id: user.id, username: user.username, roles });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      roles,
      departmentId: user.department_id,
      rank: user.rank,
    },
  };
}

/**
 * @param {{rawRefreshToken: string|undefined}} params
 * @returns {Promise<{accessToken: string, user: object}>}
 */
async function refresh({ rawRefreshToken }) {
  if (!rawRefreshToken) {
    throw httpError(401, 'UNAUTHENTICATED', 'No refresh token provided.');
  }

  const hash = jwtService.hashOpaqueToken(rawRefreshToken);
  const session = await repository.findSessionByHash(hash);

  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    throw httpError(401, 'INVALID_SESSION', 'Session is invalid or expired.');
  }

  const user = await repository.findUserById(session.user_id);
  if (!user || user.status !== 'ACTIVE') {
    throw httpError(401, 'INVALID_SESSION', 'Session is invalid or expired.');
  }

  // Fresh roles from DB, never trusting stale claims from a prior token.
  const roles = await repository.findRoleNamesForUser(user.id);
  const accessToken = jwtService.signAccessToken({ id: user.id, username: user.username, roles });

  return {
    accessToken,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      roles,
      departmentId: user.department_id,
      rank: user.rank,
    },
  };
}

/**
 * @param {{rawRefreshToken: string|undefined}} params
 */
async function logout({ rawRefreshToken }) {
  if (!rawRefreshToken) return { loggedOut: false };

  const hash = jwtService.hashOpaqueToken(rawRefreshToken);
  const session = await repository.findSessionByHash(hash);

  await withTransaction(async (client) => {
    await repository.revokeSessionByHash(hash, client);
    if (session) {
      await ledger.appendEvent(client, {
        actorUserId: session.user_id,
        action: 'LOGOUT',
        resourceType: 'user',
        resourceId: session.user_id,
        result: 'SUCCESS',
      });
    }
  });

  return { loggedOut: true };
}

// --- MFA (TOTP) ---------------------------------------------------------

async function enrollMfa({ userId, username }) {
  const secret = mfaService.generateSecret();
  const otpauthUrl = mfaService.buildOtpAuthUri(secret, username);
  const qrCodeDataUrl = await mfaService.generateQrCodeDataUrl(otpauthUrl);

  // Delete-then-insert keeps re-enrollment-before-verification idempotent.
  await repository.deleteUnverifiedMfaCredentials(userId);
  await repository.insertMfaCredential({ userId, type: 'TOTP', secret });

  return { secret, otpauthUrl, qrCodeDataUrl };
}

async function verifyMfaEnrollment({ userId, otp }) {
  const credential = await repository.findLatestUnverifiedMfaCredential(userId);
  if (!credential) {
    throw httpError(400, 'NO_PENDING_ENROLLMENT', 'No pending MFA enrollment found.');
  }
  if (!mfaService.verifyToken(credential.secret, otp)) {
    throw httpError(400, 'INVALID_OTP', 'Invalid code.');
  }

  await withTransaction(async (client) => {
    await repository.markMfaCredentialVerified(credential.id, client);
    await repository.setMfaEnabled(userId, true, client);
    await ledger.appendEvent(client, {
      actorUserId: userId,
      action: 'MFA_ENROLLED',
      resourceType: 'user',
      resourceId: userId,
      result: 'SUCCESS',
    });
  });

  return { mfaEnabled: true };
}

// --- me -------------------------------------------------------------------

async function getMe({ userId }) {
  const user = await repository.findUserById(userId);
  if (!user) throw httpError(404, 'NOT_FOUND', 'User not found.');
  const roles = await repository.findRoleNamesForUser(userId);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    roles,
    // Access tokens don't carry these (see users.service.js's own-role
    // lookups) — /me is the one place the frontend can read them without
    // an extra admin-only /users/:id round trip. Needed by the police-
    // hierarchy invite form to scope its department picker to the
    // caller's own unit.
    departmentId: user.department_id,
    rank: user.rank,
    mfaEnabled: user.mfa_enabled,
  };
}

module.exports = { health, login, refresh, logout, enrollMfa, verifyMfaEnrollment, getMe };
