'use client';

import { useEffect, useState, useCallback } from 'react';
import { ROLE_LIST } from '@secure-dms/shared';
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

export default function AdminUsersPage() {
  const { user, loading } = useAuth();

  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [listError, setListError] = useState(null);

  const [inviteForm, setInviteForm] = useState({ username: '', email: '', roleName: ROLE_LIST[0], departmentId: '' });
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const isAdmin = !!user && user.roles.includes('ADMINISTRATOR');

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
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  async function handleInvite(e) {
    e.preventDefault();
    setInviteError(null);
    setInviteResult(null);
    setInviting(true);
    try {
      const payload = { ...inviteForm };
      if (!payload.departmentId) delete payload.departmentId;
      const result = await apiJson('/users/invite', { method: 'POST', body: JSON.stringify(payload) });
      setInviteResult(result);
      setInviteForm({ username: '', email: '', roleName: ROLE_LIST[0], departmentId: '' });
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
  if (!isAdmin) {
    return (
      <AuthLayout title="Access denied" subtitle="You must be an administrator to view this page.">
        <a href="/login">Sign in as an administrator</a>
      </AuthLayout>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          title="User management"
          subtitle="Invite investigators, forensic officers, prosecutors, and auditors; manage status and roles."
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
                  onChange={(e) => setInviteForm({ ...inviteForm, roleName: e.target.value })}
                >
                  {ROLE_LIST.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department (optional)">
                <select
                  className="input"
                  value={inviteForm.departmentId}
                  onChange={(e) => setInviteForm({ ...inviteForm, departmentId: e.target.value })}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={inviting}>
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
                            {ROLE_LIST.map((r) => (
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
