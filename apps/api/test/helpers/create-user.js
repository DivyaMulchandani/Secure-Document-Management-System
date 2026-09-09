'use strict';

const request = require('supertest');
const { ROLE_LEVELS, parseRole } = require('@secure-dms/shared');

/**
 * Shared across every *.test.js file (previously duplicated ~14 times).
 * Builds on the police-hierarchy role system: creating a deep role (e.g.
 * STATION_ADMIN, 4 hops below STATE_HQ) requires an admin at every
 * level in between, each only able to create its own direct children —
 * `createActivatedUser` walks that chain automatically from the
 * bootstrap admin, caching intermediate admins per level so repeated
 * calls in the same test file don't rebuild the whole chain every time
 * (pass `{ fresh: true }` to force a brand-new chain when a test
 * genuinely needs an independent unit).
 *
 * Every exported function takes `app` (the Supertest-wrapped Express
 * app) explicitly — no shared module-level app instance, since each
 * test file builds its own.
 */

function unique(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function levelOf(roleName) {
  const parsed = parseRole(roleName);
  if (!parsed) throw new Error(`Not a valid role name: ${roleName}`);
  return parsed;
}

function firstParentLevel(level) {
  const info = ROLE_LEVELS.find((l) => l.level === level);
  if (!info || info.parentLevels.length === 0) {
    throw new Error(`Level ${level} has no parent — can't be created via invite (bootstrap-only, e.g. STATE_HQ).`);
  }
  return info.parentLevels[0];
}

async function loginBootstrapAdmin(app) {
  const res = await request(app).post('/api/v1/auth/login').send({
    username: process.env.BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(`bootstrap admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { userId: res.body.user.id, accessToken: res.body.accessToken, username: res.body.user.username };
}

/** One raw invite -> activate -> login round trip. `inviterToken` must belong to a role authorized to create `roleName` (see users.service.js#assertCreationAuthority). */
async function invite(app, inviterToken, roleName, { newUnitName, departmentId, rank } = {}) {
  const username = unique(roleName.toLowerCase());
  const email = `${username}@example.com`;
  const password = 'Str0ngP@ssw0rd!';

  const body = { username, email, roleName };
  if (newUnitName) body.newUnitName = newUnitName;
  if (departmentId) body.departmentId = departmentId;
  if (rank) body.rank = rank;

  const inviteRes = await request(app)
    .post('/api/v1/users/invite')
    .set('Authorization', `Bearer ${inviterToken}`)
    .send(body);
  if (inviteRes.status !== 200) {
    throw new Error(`invite ${roleName} failed: ${inviteRes.status} ${JSON.stringify(inviteRes.body)}`);
  }

  const activateRes = await request(app)
    .post(`/api/v1/users/activate/${inviteRes.body.activationToken}`)
    .send({ password, fullName: username });
  if (activateRes.status !== 200) {
    throw new Error(`activate ${roleName} failed: ${activateRes.status} ${JSON.stringify(activateRes.body)}`);
  }

  const loginRes = await request(app).post('/api/v1/auth/login').send({ username, password });
  if (loginRes.status !== 200) {
    throw new Error(`login ${roleName} failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  return { userId: loginRes.body.user.id, accessToken: loginRes.body.accessToken, username };
}

/**
 * Ensures an `_ADMIN` exists at `level`, recursively building every
 * parent level from STATE_HQ (the bootstrap admin) down as needed. Each
 * level's admin (and the department it heads) is created once and
 * cached in `cache` (keyed by level) for the lifetime of the caller's
 * cache object — pass a fresh `{}` for full isolation, or share one
 * across a describe block to reuse the same chain.
 */
async function ensureAdmin(app, level, cache) {
  if (level === 'STATE_HQ') {
    if (!cache.STATE_HQ) cache.STATE_HQ = await loginBootstrapAdmin(app);
    return cache.STATE_HQ;
  }
  if (cache[level]) return cache[level];

  const parentAdmin = await ensureAdmin(app, firstParentLevel(level), cache);
  const created = await invite(app, parentAdmin.accessToken, `${level}_ADMIN`, { newUnitName: unique(level) });
  cache[level] = created;
  return created;
}

const defaultCache = {};

/**
 * @param {import('express').Express} app
 * @param {string} roleName e.g. 'COMMISSIONERATE_ADMIN', 'STATION_OFFICER' — any
 *   of the 44 police-hierarchy roles; deep ones (further from STATE_HQ)
 *   cost more HTTP round trips the first time a level is touched, so
 *   prefer a shallow role (an immediate STATE_HQ child, e.g.
 *   COMMISSIONERATE_ADMIN/_OFFICER) unless the test specifically needs a
 *   deeper unit
 * @param {{fresh?: boolean, rank?: string}} [options] `fresh: true` builds
 *   a brand-new chain instead of reusing this file's cached one.
 * @returns {Promise<{userId: string, accessToken: string, username: string}>}
 */
async function createActivatedUser(app, roleName, { fresh = false, rank } = {}) {
  const { level, side } = levelOf(roleName);
  const cache = fresh ? {} : defaultCache;
  const adminLevel = side === 'OFFICER' ? level : firstParentLevel(level);
  const admin = await ensureAdmin(app, adminLevel, cache);
  const opts = side === 'OFFICER' ? { rank } : { newUnitName: unique(level), rank };
  return invite(app, admin.accessToken, roleName, opts);
}

module.exports = { unique, loginBootstrapAdmin, invite, ensureAdmin, createActivatedUser };
