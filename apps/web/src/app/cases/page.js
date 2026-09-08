'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CASE_PRIORITY_LIST } from '@secure-dms/shared';
import { useAuth } from '../../lib/auth-context';
import { apiJson } from '../../lib/api-client';

export default function CasesPage() {
  const { user, loading } = useAuth();
  const [cases, setCases] = useState([]);
  const [listError, setListError] = useState(null);

  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM' });
  const [createError, setCreateError] = useState(null);
  const [creating, setCreating] = useState(false);

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
      refresh();
    } catch (err) {
      setCreateError(err.message || 'Failed to create case.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <main style={{ padding: '2rem' }}>Loading…</main>;
  if (!user) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <p>
          <a href="/login">Sign in</a> to view cases.
        </p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Cases</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>New case</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label>
            Title
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Description
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Priority
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              style={{ display: 'block' }}
            >
              {CASE_PRIORITY_LIST.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create case'}
          </button>
        </form>
        {createError && <p style={{ color: 'crimson' }}>{createError}</p>}
      </section>

      <section>
        {listError && <p style={{ color: 'crimson' }}>{listError}</p>}
        <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
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
                  <Link href={`/cases/${c.id}`}>{c.case_number}</Link>
                </td>
                <td>{c.title}</td>
                <td>{c.status}</td>
                <td>{c.priority}</td>
                <td>{c.owner_username}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
