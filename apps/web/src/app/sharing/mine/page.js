'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth-context';
import { apiJson } from '../../../lib/api-client';
import AppShell from '../../../components/AppShell';
import AuthLayout from '../../../components/AuthLayout';
import { Alert, EmptyState, PageHeader, ShareStatusBadge } from '../../../components/ui';

export default function SharedWithMePage() {
  const { user, loading } = useAuth();

  const [shares, setShares] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setShares(await apiJson('/sharing/mine'));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load what’s been shared with you.');
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view documents shared with you.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          title="Shared with me"
          subtitle="Documents someone gave you time-limited access to, even outside your usual cases."
        />
        <Alert>{error}</Alert>

        {shares.length === 0 ? (
          <EmptyState>Nothing has been shared with you.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Shared by</th>
                  <th>Permission</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.status === 'ACTIVE' ? (
                        <Link href={`/cases/${s.case_id}/documents/${s.document_id}`}>
                          <strong>{s.document_title}</strong>
                        </Link>
                      ) : (
                        <span className="muted">{s.document_title}</span>
                      )}
                    </td>
                    <td className="muted">{s.shared_by_username}</td>
                    <td className="muted">{s.permission_code}</td>
                    <td className="muted">{new Date(s.expires_at).toLocaleString()}</td>
                    <td>
                      <ShareStatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
