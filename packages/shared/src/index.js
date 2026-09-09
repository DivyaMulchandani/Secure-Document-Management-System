'use strict';

const {
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
} = require('./constants/roles');
const { PERMISSIONS, PERMISSION_LIST } = require('./constants/permissions');
const { DOCUMENT_TYPES, DOCUMENT_TYPE_LIST } = require('./constants/document-types');
const { CASE_ROLES, CASE_ROLE_LIST } = require('./constants/case-roles');
const { CASE_STATUSES, CASE_STATUS_LIST } = require('./constants/case-statuses');
const { CASE_PRIORITIES, CASE_PRIORITY_LIST } = require('./constants/case-priorities');

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
  PERMISSIONS,
  PERMISSION_LIST,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LIST,
  CASE_ROLES,
  CASE_ROLE_LIST,
  CASE_STATUSES,
  CASE_STATUS_LIST,
  CASE_PRIORITIES,
  CASE_PRIORITY_LIST,
};
