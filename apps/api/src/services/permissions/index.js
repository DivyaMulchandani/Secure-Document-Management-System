'use strict';

/**
 * STUB — Sprint 0.
 *
 * Real implementation evaluates RBAC role + case scope + resource grant
 * together into an allow/deny decision (see docs/architecture — "Access
 * model"). This is the function the rbac.js middleware will eventually
 * call. Defaults to deny so nothing can accidentally rely on this stub
 * granting access.
 *
 * @param {object|null} user
 * @param {string} action
 * @param {{type: string, id: string}} resource
 * @returns {Promise<boolean>}
 */
async function can(/* user, action, resource */) {
  return false;
}

module.exports = { can };
