'use client';

import { useEffect, useState, useCallback } from 'react';
import { ROLE_LIST } from '@secure-dms/shared';
import { useAuth } from '../../../lib/auth-context';
import { apiJson } from '../../../lib/api-client';

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

  const isAdmin = !!user && user.roles.includes('ADMINISTRATOR');

  const refresh = useCallback(async () => {
    try {
      const [userList, departmentList] = await Promise.all([
        apiJson('/users'),
        apiJson('/users/departments'),
      ]);
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

  if (loading) return <main style={{ padding: '2rem' }}>Loading…</main>;
  if (!isAdmin) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <h1>Access denied</h1>
        <p>
          You must be an administrator to view this page. <a href="/login">Sign in</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>User management</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Invite a user</h2>
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label>
            Username
            <input
              value={inviteForm.username}
              onChange={(e) => setInviteForm({ ...inviteForm, username: e.target.value })}
              required
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              required
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Role
            <select
              value={inviteForm.roleName}
              onChange={(e) => setInviteForm({ ...inviteForm, roleName: e.target.value })}
              style={{ display: 'block' }}
            >
              {ROLE_LIST.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department (optional)
            <select
              value={inviteForm.departmentId}
              onChange={(e) => setInviteForm({ ...inviteForm, departmentId: e.target.value })}
              style={{ display: 'block' }}
            >
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={inviting}>
            {inviting ? 'Inviting…' : 'Invite'}
          </button>
        </form>
        {inviteError && <p style={{ color: 'crimson' }}>{inviteError}</p>}
        {inviteResult?.activationUrl && (
          <p>
            Dev/test mode — activation link: <code>{inviteResult.activationUrl}</code>
          </p>
        )}
      </section>

      <section>
        <h2>Users</h2>
        {listError && <p style={{ color: 'crimson' }}>{listError}</p>}
        <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
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
                <td>{u.username}</td>
                <td>{u.email}</td>
                <td>{u.status}</td>
                <td>{u.roles.join(', ') || '—'}</td>
                <td>{u.department_name || '—'}</td>
                <td>{u.failed_login_count}</td>
                <td style={{ display: 'flex', gap: '0.5rem' }}>
                  <select defaultValue="" onChange={(e) => e.target.value && handleStatusChange(u.id, e.target.value)}>
                    <option value="">Set status…</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
