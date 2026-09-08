'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth-context';
import { apiJson } from '../../../lib/api-client';
import AppShell from '../../../components/AppShell';
import AuthLayout from '../../../components/AuthLayout';
import { Alert, Button, EmptyState, PageHeader } from '../../../components/ui';

export default function SignatureQueuePage() {
  const { user, loading } = useAuth();

  const [myKey, setMyKey] = useState(null);
  const [keyError, setKeyError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const [queue, setQueue] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [declineReasons, setDeclineReasons] = useState({});

  const refresh = useCallback(async () => {
    try {
      setQueue(await apiJson('/signatures/queue'));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load your signature queue.');
    }
    try {
      setMyKey(await apiJson('/signatures/keys/me'));
    } catch {
      setMyKey(null); // 404 = no active key yet, not a real error
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  async function handleGenerateKey() {
    setKeyError(null);
    setGenerating(true);
    try {
      setMyKey(await apiJson('/signatures/keys', { method: 'POST' }));
    } catch (err) {
      setKeyError(err.message || 'Failed to generate a signing key.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSign(id) {
    setError(null);
    setBusyId(id);
    try {
      await apiJson(`/signatures/${id}/sign`, { method: 'POST' });
      refresh();
    } catch (err) {
      setError(err.message || 'Signing failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(id) {
    setError(null);
    setBusyId(id);
    try {
      await apiJson(`/signatures/${id}/decline`, {
        method: 'POST',
        body: JSON.stringify({ reason: declineReasons[id] || undefined }),
      });
      refresh();
    } catch (err) {
      setError(err.message || 'Declining failed.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view your signature queue.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader title="Signature queue" subtitle="Documents waiting on your signature." />

        <div className="card card-tint" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h2>My signing key</h2>
          </div>
          {myKey ? (
            <div className="text-sm">
              <span className="muted">Active RSA-2048 key — fingerprint </span>
              <code>{myKey.fingerprint.slice(0, 20)}…</code>
              <div style={{ marginTop: 10 }}>
                <Button size="sm" variant="outline" disabled={generating} onClick={handleGenerateKey}>
                  {generating ? 'Rotating…' : 'Rotate key'}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="muted text-sm" style={{ marginTop: 0 }}>
                Generate a signing key before you can sign anything — it's yours alone, and every future
                signature is made with it.
              </p>
              <Button disabled={generating} onClick={handleGenerateKey}>
                {generating ? 'Generating…' : 'Generate my signing key'}
              </Button>
            </div>
          )}
          <Alert>{keyError}</Alert>
        </div>

        <Alert>{error}</Alert>

        {queue.length === 0 ? (
          <EmptyState>Nothing waiting on your signature.</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {queue.map((item) => (
              <div key={item.id} className="card">
                <Link href={`/cases/${item.case_id}/documents/${item.document_id}`}>
                  <strong>{item.document_title}</strong>
                </Link>
                <div className="text-sm muted" style={{ marginTop: 4 }}>
                  Requested by {item.requested_by_username || '—'}
                  {item.reason ? ` — "${item.reason}"` : ''}
                </div>

                <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
                  <Button size="sm" disabled={busyId === item.id || !myKey} onClick={() => handleSign(item.id)}>
                    {busyId === item.id ? '…' : 'Sign'}
                  </Button>
                  <input
                    className="input"
                    style={{ maxWidth: 220 }}
                    placeholder="Decline reason (optional)"
                    value={declineReasons[item.id] || ''}
                    onChange={(e) => setDeclineReasons({ ...declineReasons, [item.id]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId === item.id}
                    onClick={() => handleDecline(item.id)}
                  >
                    Decline
                  </Button>
                </div>
                {!myKey && (
                  <div className="text-sm muted" style={{ marginTop: 8 }}>
                    Generate a signing key above before you can sign this.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
