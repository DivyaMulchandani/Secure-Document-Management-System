'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CASE_PRIORITY_LIST } from '@secure-dms/shared';
import { useAuth } from '../../lib/auth-context';
import { apiJson } from '../../lib/api-client';
import AppShell from '../../components/AppShell';
import AuthLayout from '../../components/AuthLayout';
import { Alert, Badge, Button, CaseStatusBadge, EmptyState, Field, PageHeader, PriorityBadge } from '../../components/ui';

export default function CasesPage() {
  const { user, loading } = useAuth();
  const [cases, setCases] = useState([]);
  const [listError, setListError] = useState(null);

  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM' });
  const [createError, setCreateError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await apiJson('/cases');
      setCases(result);
      setListError(null);
    } catch (err) {
      setListError(err.message || 'Failed to load cases.');
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiJson('/cases', { method: 'POST', body: JSON.stringify(form) });
      setForm({ title: '', description: '', priority: 'MEDIUM' });
      setShowForm(false);
      refresh();
    } catch (err) {
      setCreateError(err.message || 'Failed to create case.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view your cases.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          title="Cases"
          subtitle="Investigation and legal case files you own or are a member of."
          actions={
            <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? 'outline' : 'primary'}>
              {showForm ? 'Cancel' : '+ New case'}
            </Button>
          }
        />

        {showForm && (
          <div className="card card-tint section">
            <h2>Create a case</h2>
            <form onSubmit={handleCreate} className="form-grid">
              <Field label="Title">
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </Field>
              <Field label="Description">
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
              <Field label="Priority">
                <select
                  className="input"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {CASE_PRIORITY_LIST.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create case'}
              </Button>
            </form>
            <Alert>{createError}</Alert>
          </div>
        )}

        <div className="section">
          <Alert>{listError}</Alert>
          {cases.length === 0 ? (
            <EmptyState>No cases yet. Create one to get started.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Case #</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/cases/${c.id}`}>
                          <strong>{c.case_number}</strong>
                        </Link>
                      </td>
                      <td>{c.title}</td>
                      <td>
                        <CaseStatusBadge status={c.status} />
                      </td>
                      <td>
                        <PriorityBadge priority={c.priority} />
                      </td>
                      <td>
                        <Badge>{c.owner_username}</Badge>
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
