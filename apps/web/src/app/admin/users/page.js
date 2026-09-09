'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createsRolesFor, parseRole, roleTitle } from '@secure-dms/shared';
import { useAuth } from '../../../lib/auth-context';
import { apiJson } from '../../../lib/api-client';
import AppShell from '../../../components/AppShell';
import AuthLayout from '../../../components/AuthLayout';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  PageHeader,
  RoleBadge,
  UserStatusBadge,
} from '../../../components/ui';

const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'LOCKED'];
const EMPTY_INVITE = { username: '', email: '', roleName: '', departmentId: '', newUnitName: '', rank: '' };

export default function AdminUsersPage() {
  const { user, loading } = useAuth();

  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [listError, setListError] = useState(null);

  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE);
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [creatingUnit, setCreatingUnit] = useState(false);

  const myRole = (user?.roles || [])[0];
  // "Admin" now means "this role creates at least one other role" — any
  // _ADMIN in the police hierarchy, not a single fixed role name.
  const creatableRoles = useMemo(() => createsRolesFor(myRole), [myRole]);
  const canManageUsers = creatableRoles.length > 0;

  const refresh = useCallback(async () => {
    try {
      const [userList, departmentList] = await Promise.all([apiJson('/users'), apiJson('/users/departments')]);
      setUsers(userList);
      setDepartments(departmentList);
      setListError(null);
    } catch (err) {
      setListError(err.message || 'Failed to load users.');
    }
  }, []);

  useEffect(() => {
    if (canManageUsers) refresh();
  }, [canManageUsers, refresh]);

  // Only units directly under the caller's own department, matching the
  // right unit type for the selected role — mirrors the exact scoping
  // users.service.js#assertCreationAuthority enforces server-side, so the
  // picker never offers a choice the API would reject.
  const selectedParsed = inviteForm.roleName ? parseRole(inviteForm.roleName) : null;
  const isOwnOfficerRole = selectedParsed?.side === 'OFFICER';
  const eligibleChildDepartments = useMemo(() => {
    if (!selectedParsed || isOwnOfficerRole || !user?.departmentId) return [];
    return departments.filter((d) => d.parent_department_id === user.departmentId && d.unit_type === selectedParsed.level);
  }, [departments, selectedParsed, isOwnOfficerRole, user?.departmentId]);

  async function handleInvite(e) {
    e.preventDefault();
    setInviteError(null);
    setInviteResult(null);
    setInviting(true);
    try {
      const payload = {
        username: inviteForm.username,
        email: inviteForm.email,
        roleName: inviteForm.roleName,
      };
      if (inviteForm.rank) payload.rank = inviteForm.rank;
      if (!isOwnOfficerRole) {
        if (creatingUnit && inviteForm.newUnitName) payload.newUnitName = inviteForm.newUnitName;
        else if (inviteForm.departmentId) payload.departmentId = inviteForm.departmentId;
      }
      const result = await apiJson('/users/invite', { method: 'POST', body: JSON.stringify(payload) });
      setInviteResult(result);
      setInviteForm(EMPTY_INVITE);
      setCreatingUnit(false);
      refresh();
    } catch (err) {
      setInviteError(err.message || 'Invite failed.');
    } finally {
      setInviting(false);
    }
  }

  async function handleStatusChange(id, status) {
    await apiJson(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    refresh();
  }

  async function handleRolesChange(id, roleNames) {
    await apiJson(`/users/${id}/roles`, { method: 'PUT', body: JSON.stringify({ roleNames }) });
    refresh();
  }

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!canManageUsers) {
    return (
      <AuthLayout title="Access denied" subtitle="Your role doesn't manage any accounts.">
        <a href="/login">Sign in with an account-managing role</a>
      </AuthLayout>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          title="User management"
          subtitle={`Signed in as ${roleTitle(myRole)} (${myRole}) — you may create: ${creatableRoles.join(', ')}.`}
          actions={
            <Button variant={showInvite ? 'outline' : 'primary'} onClick={() => setShowInvite((v) => !v)}>
              {showInvite ? 'Cancel' : '+ Invite user'}
            </Button>
          }
        />

        {showInvite && (
          <div className="card card-tint section">
            <h2>Invite a user</h2>
            <form onSubmit={handleInvite} className="form-grid">
              <Field label="Username">
                <input
                  className="input"
                  value={inviteForm.username}
                  onChange={(e) => setInviteForm({ ...inviteForm, username: e.target.value })}
                  required
                />
              </Field>
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  required
                />
              </Field>
              <Field label="Role">
                <select
                  className="input"
                  value={inviteForm.roleName}
                  onChange={(e) => {
                    setInviteForm({ ...inviteForm, roleName: e.target.value, departmentId: '', newUnitName: '' });
                    setCreatingUnit(false);
                  }}
                  required
                >
                  <option value="">— choose a role —</option>
                  {creatableRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleTitle(role)} ({role})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rank / job title (optional)">
                <input
                  className="input"
                  value={inviteForm.rank}
                  onChange={(e) => setInviteForm({ ...inviteForm, rank: e.target.value })}
                  placeholder="e.g. PSI, Jt.CP, Internal Audit"
                />
              </Field>

              {selectedParsed && !isOwnOfficerRole && (
                <Field label="Unit">
                  {!creatingUnit ? (
                    <div className="stack" style={{ gap: 6 }}>
                      <select
                        className="input"
                        value={inviteForm.departmentId}
                        onChange={(e) => setInviteForm({ ...inviteForm, departmentId: e.target.value })}
                      >
                        <option value="">— choose an existing {selectedParsed.level} unit —</option>
                        {eligibleChildDepartments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setCreatingUnit(true)}>
                        + Create a new {selectedParsed.level} unit instead
                      </Button>
                    </div>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      <input
                        className="input"
                        value={inviteForm.newUnitName}
                        onChange={(e) => setInviteForm({ ...inviteForm, newUnitName: e.target.value })}
                        placeholder={`New ${selectedParsed.level} unit name`}
                        required
                      />
                      <Button type="button" size="sm" variant="ghost" onClick={() => setCreatingUnit(false)}>
                        Pick an existing unit instead
                      </Button>
                    </div>
                  )}
                </Field>
              )}

              <Button type="submit" disabled={inviting || !inviteForm.roleName}>
                {inviting ? 'Inviting…' : 'Invite'}
              </Button>
            </form>
            <Alert>{inviteError}</Alert>
            {inviteResult?.activationUrl && (
              <Alert tone="info">
                Dev/test mode — activation link: <code>{inviteResult.activationUrl}</code>
              </Alert>
            )}
          </div>
        )}

        <div className="section">
          <Alert>{listError}</Alert>
          {users.length === 0 ? (
            <EmptyState>No users yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Roles</th>
                    <th>Department</th>
                    <th>Failed logins</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.username}</strong>
                      </td>
                      <td className="muted">{u.email}</td>
                      <td>
                        <UserStatusBadge status={u.status} />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {u.roles.length ? u.roles.map((r) => <RoleBadge key={r} role={r} />) : '—'}
                        </div>
                      </td>
                      <td className="muted">{u.department_name || '—'}</td>
                      <td>{u.failed_login_count}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <select
                            className="input"
                            style={{ padding: '5px 8px', fontSize: 12.5 }}
                            defaultValue=""
                            onChange={(e) => e.target.value && handleStatusChange(u.id, e.target.value)}
                          >
                            <option value="">Set status…</option>
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input"
                            style={{ padding: '5px 8px', fontSize: 12.5 }}
                            defaultValue=""
                            onChange={(e) => e.target.value && handleRolesChange(u.id, [e.target.value])}
                          >
                            <option value="">Set role…</option>
                            {creatableRoles.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
