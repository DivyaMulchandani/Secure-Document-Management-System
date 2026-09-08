'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { apiJson, apiFetch, apiBlob } from '../../../../../lib/api-client';
import AppShell from '../../../../../components/AppShell';
import AuthLayout from '../../../../../components/AuthLayout';
import {
  Alert,
  Badge,
  Button,
  CustodyStatusBadge,
  EmptyState,
  EvidenceStatusBadge,
  Field,
  IntegrityBadge,
} from '../../../../../components/ui';

// Status -> the single forward action available from it (mirrors
// evidence.service.js's ALLOWED_TRANSITIONS — the UI just surfaces one
// button per state; the server is the actual authority). requiresCustodian
// mirrors which service functions call assertIsCurrentCustodian: seal,
// analysis/start, analysis/complete do; verify and archive deliberately
// don't (verify is a read-only integrity check anyone with VERIFY can run;
// archive is a case-closure action decoupled from physical custody).
const ACTION_BY_STATUS = {
  REGISTERED: { label: 'Seal evidence', path: 'seal', requiresCustodian: true },
  SEALED: { label: 'Verify integrity', path: 'verify', requiresCustodian: false },
  RECEIVED: { label: 'Start analysis', path: 'analysis/start', requiresCustodian: true },
  UNDER_ANALYSIS: { label: 'Complete analysis', path: 'analysis/complete', requiresCustodian: true },
  RETURNED: { label: 'Archive', path: 'archive', requiresCustodian: false },
};

export default function EvidenceDetailPage() {
  const { id: caseId, evidenceId } = useParams();
  const { user, loading } = useAuth();

  const [evidence, setEvidence] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [busyArtifactId, setBusyArtifactId] = useState(null);

  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({ toUserId: '', reason: '', toLocation: '' });
  const [rejectReason, setRejectReason] = useState('');

  const [artifactFile, setArtifactFile] = useState(null);
  const [addingArtifact, setAddingArtifact] = useState(false);

  const [chainResult, setChainResult] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [ev, tl] = await Promise.all([
        apiJson(`/evidence/${evidenceId}`),
        apiJson(`/evidence/${evidenceId}/custody`),
      ]);
      setEvidence(ev);
      setTimeline(tl);
      setError(null);
      if (ev.case_id) {
        apiJson(`/cases/${ev.case_id}/members`)
          .then(setMembers)
          .catch(() => {});
      }
    } catch (err) {
      setError(err.message || 'Failed to load evidence.');
    }
  }, [evidenceId]);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  async function runAction(path, options = {}) {
    setActionError(null);
    setBusy(true);
    try {
      await apiJson(`/evidence/${evidenceId}/${path}`, options);
      refresh();
    } catch (err) {
      setActionError(err.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferRequest(e) {
    e.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      await apiJson(`/evidence/${evidenceId}/transfers`, {
        method: 'POST',
        body: JSON.stringify(transferForm),
      });
      setTransferForm({ toUserId: '', reason: '', toLocation: '' });
      setShowTransferForm(false);
      refresh();
    } catch (err) {
      setActionError(err.message || 'Transfer request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(transferId) {
    await runAction(`transfers/${transferId}/accept`, { method: 'POST' });
  }

  async function handleReject(transferId) {
    setActionError(null);
    setBusy(true);
    try {
      await apiJson(`/evidence/${evidenceId}/transfers/${transferId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason || undefined }),
      });
      setRejectReason('');
      refresh();
    } catch (err) {
      setActionError(err.message || 'Rejecting the transfer failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddArtifact(e) {
    e.preventDefault();
    if (!artifactFile) return;
    setActionError(null);
    setAddingArtifact(true);
    try {
      const body = new FormData();
      body.append('file', artifactFile);
      const res = await apiFetch(`/evidence/${evidenceId}/artifacts`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Adding the artifact failed.');
      setArtifactFile(null);
      refresh();
    } catch (err) {
      setActionError(err.message || 'Adding the artifact failed.');
    } finally {
      setAddingArtifact(false);
    }
  }

  async function handleDownload(artifactId) {
    setDownloadError(null);
    setBusyArtifactId(artifactId);
    try {
      const { blob } = await apiBlob(`/evidence/${evidenceId}/artifacts/${artifactId}/download`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setDownloadError(
        err.code === 'CUSTODY_VIOLATION' || err.code === 'INTEGRITY_FAILURE'
          ? 'Integrity check failed — this content no longer matches its recorded hash. Download blocked.'
          : err.message || 'Download failed.',
      );
    } finally {
      setBusyArtifactId(null);
    }
  }

  async function handleVerifyChain() {
    setChainResult(null);
    try {
      const res = await apiJson(`/evidence/${evidenceId}/custody/verify`);
      setChainResult(res);
    } catch (err) {
      setChainResult({ error: err.message || 'Chain verification failed.' });
    }
  }

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view this evidence item.
        </p>
      </AuthLayout>
    );
  }
  if (error && !evidence) {
    return (
      <AppShell>
        <div className="page">
          <Alert>{error}</Alert>
          <Link href={`/cases/${caseId}`}>← Back to case</Link>
        </div>
      </AppShell>
    );
  }
  if (!evidence) return <div className="skeleton-page">Loading evidence…</div>;

  const forwardAction = ACTION_BY_STATUS[evidence.status];
  const isCustodian = evidence.current_custodian_id === user.id;
  const canReturn = evidence.status === 'IN_CUSTODY';
  const canRequestTransfer = evidence.status === 'IN_CUSTODY';

  // The most recent custody event tells us whether a transfer is
  // currently awaiting the recipient's response — that's the same rule
  // the server uses (findLatestPendingTransfer).
  const lastEvent = timeline[timeline.length - 1];
  const pendingTransfer =
    lastEvent && lastEvent.action === 'TRANSFER_REQUEST' && lastEvent.status === 'PENDING' ? lastEvent : null;
  const isRecipient = pendingTransfer && pendingTransfer.to_user_id === user.id;

  const eligibleRecipients = members.filter((m) => m.user_id !== evidence.current_custodian_id);
  const custodianUsername =
    members.find((m) => m.user_id === evidence.current_custodian_id)?.username || evidence.current_custodian_id;

  return (
    <AppShell>
      <div className="page">
        <Link href={`/cases/${caseId}`} className="text-sm muted">
          ← Back to case
        </Link>

        <div className="page-header" style={{ marginTop: 8 }}>
          <div>
            <h1>
              <span className="muted" style={{ fontWeight: 400, fontSize: 18 }}>
                {evidence.evidence_number}
              </span>
              <br />
              {evidence.title}
            </h1>
            <div className="row" style={{ marginTop: 6 }}>
              <EvidenceStatusBadge status={evidence.status} />
              {evidence.category && <Badge tone="neutral">{evidence.category}</Badge>}
            </div>
          </div>
        </div>

        {evidence.description && <p className="muted">{evidence.description}</p>}
        <div className="row text-sm muted" style={{ gap: 16 }}>
          <span>Custodian: {custodianUsername}</span>
          <span>Location: {evidence.current_location || '—'}</span>
        </div>

        <Alert>{actionError}</Alert>

        <div className="section">
          <div className="card-header">
            <h2>Custody actions</h2>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {forwardAction && (isCustodian || !forwardAction.requiresCustodian) && (
              <Button disabled={busy} onClick={() => runAction(forwardAction.path, { method: 'POST' })}>
                {forwardAction.label}
              </Button>
            )}
            {evidence.status !== 'REGISTERED' && evidence.status !== 'ARCHIVED' && !forwardAction && (
              <Button variant="outline" disabled={busy} onClick={() => runAction('verify', { method: 'POST' })}>
                Re-verify integrity
              </Button>
            )}
            {canReturn && isCustodian && (
              <Button variant="outline" disabled={busy} onClick={() => runAction('return', { method: 'POST' })}>
                Return to storage
              </Button>
            )}
            {canRequestTransfer && isCustodian && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setShowTransferForm((v) => !v)}
              >
                {showTransferForm ? 'Cancel transfer' : 'Request transfer'}
              </Button>
            )}
          </div>

          {showTransferForm && (
            <form onSubmit={handleTransferRequest} className="form-grid card card-tint" style={{ marginTop: 12 }}>
              <Field label="Recipient">
                <select
                  className="input"
                  value={transferForm.toUserId}
                  onChange={(e) => setTransferForm({ ...transferForm, toUserId: e.target.value })}
                  required
                >
                  <option value="">— choose a case member —</option>
                  {eligibleRecipients.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.username} ({m.case_role})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reason">
                <input
                  className="input"
                  value={transferForm.reason}
                  onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                  placeholder="e.g. Forensic analysis"
                />
              </Field>
              <Field label="Destination location">
                <input
                  className="input"
                  value={transferForm.toLocation}
                  onChange={(e) => setTransferForm({ ...transferForm, toLocation: e.target.value })}
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Send transfer request
              </Button>
            </form>
          )}

          {pendingTransfer && (
            <div className="card card-tint" style={{ marginTop: 12 }}>
              <p style={{ margin: 0 }}>
                Pending transfer to <strong>{pendingTransfer.to_username}</strong>
                {pendingTransfer.reason ? ` — "${pendingTransfer.reason}"` : ''}
              </p>
              {isRecipient ? (
                <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
                  <Button disabled={busy} onClick={() => handleAccept(pendingTransfer.id)}>
                    Accept (integrity-check & receive)
                  </Button>
                  <input
                    className="input"
                    style={{ maxWidth: 240 }}
                    placeholder="Rejection reason (optional)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button variant="danger" disabled={busy} onClick={() => handleReject(pendingTransfer.id)}>
                    Reject
                  </Button>
                </div>
              ) : (
                <p className="muted text-sm" style={{ marginTop: 6, marginBottom: 0 }}>
                  Awaiting acknowledgement from the recipient.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="section">
          <h2>Artifacts</h2>
          <Alert>{downloadError}</Alert>
          {evidence.artifacts?.length === 0 ? (
            <EmptyState>No artifacts on this evidence item.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Integrity</th>
                    <th>Size</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {evidence.artifacts?.map((a) => (
                    <tr key={a.id}>
                      <td>{a.file_name}</td>
                      <td>
                        <IntegrityBadge status={a.integrity_status} />
                      </td>
                      <td className="muted">{a.size_bytes} bytes</td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(a.id)}
                          disabled={busyArtifactId === a.id}
                        >
                          {busyArtifactId === a.id ? '…' : 'Download'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={handleAddArtifact} className="row" style={{ marginTop: 12 }}>
            <input
              className="input"
              type="file"
              onChange={(e) => setArtifactFile(e.target.files?.[0] || null)}
            />
            <Button type="submit" variant="secondary" disabled={addingArtifact || !artifactFile}>
              {addingArtifact ? 'Encrypting…' : '+ Add artifact'}
            </Button>
          </form>
        </div>

        <div className="section">
          <div className="card-header">
            <h2>Chain of custody</h2>
            <Button size="sm" variant="outline" onClick={handleVerifyChain}>
              Verify chain integrity
            </Button>
          </div>

          {chainResult && (
            <Alert tone={chainResult.error ? 'danger' : chainResult.intact ? 'success' : 'danger'}>
              {chainResult.error
                ? chainResult.error
                : chainResult.intact
                  ? `Chain intact — ${chainResult.totalEvents} events verified.`
                  : `Chain broken at event ${chainResult.brokenAtId}.`}
            </Alert>
          )}

          {timeline.length === 0 ? (
            <EmptyState>No custody events yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((event) => (
                    <tr key={event.id}>
                      <td className="muted text-sm">{new Date(event.created_at).toLocaleString()}</td>
                      <td>
                        <strong>{event.action}</strong>
                      </td>
                      <td>
                        <CustodyStatusBadge status={event.status} />
                      </td>
                      <td className="muted">{event.from_username || '—'}</td>
                      <td className="muted">{event.to_username || '—'}</td>
                      <td className="muted">{event.reason || '—'}</td>
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
