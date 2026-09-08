'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth-context';
import { apiJson } from '../../../lib/api-client';
import AppShell from '../../../components/AppShell';
import AuthLayout from '../../../components/AuthLayout';
import { Alert, Button, EmptyState, PageHeader } from '../../../components/ui';

export default function ApprovalInboxPage() {
  const { user, loading } = useAuth();

  const [inbox, setInbox] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [comments, setComments] = useState({});

  const refresh = useCallback(async () => {
    try {
      setInbox(await apiJson('/approval/inbox'));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load your approval inbox.');
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  async function decide(stepId, decision) {
    setError(null);
    setBusyId(stepId);
    try {
      await apiJson(`/approval/steps/${stepId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, comments: comments[stepId] || undefined }),
      });
      refresh();
    } catch (err) {
      setError(err.message || 'Recording the decision failed.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view your approval inbox.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader title="Approval inbox" subtitle="Documents waiting on your review." />
        <Alert>{error}</Alert>

        {inbox.length === 0 ? (
          <EmptyState>Nothing waiting on your review.</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {inbox.map((step) => (
              <div key={step.id} className="card">
                <Link href={`/cases/${step.case_id}/documents/${step.document_id}`}>
                  <strong>{step.document_title}</strong>
                </Link>
                <div className="text-sm muted" style={{ marginTop: 4 }}>
                  Requested by {step.requested_by_username} · step {step.step_order + 1}
                </div>

                <textarea
                  className="input"
                  style={{ width: '100%', minHeight: 60, resize: 'vertical', marginTop: 10 }}
                  placeholder="Comments (optional)"
                  value={comments[step.id] || ''}
                  onChange={(e) => setComments({ ...comments, [step.id]: e.target.value })}
                />
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" disabled={busyId === step.id} onClick={() => decide(step.id, 'APPROVED')}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === step.id}
                    onClick={() => decide(step.id, 'REVISION_REQUESTED')}
                  >
                    Request revision
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId === step.id}
                    onClick={() => decide(step.id, 'REJECTED')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
