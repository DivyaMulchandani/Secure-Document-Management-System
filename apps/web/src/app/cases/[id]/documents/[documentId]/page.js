'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { apiJson, apiBlob } from '../../../../../lib/api-client';
import AppShell from '../../../../../components/AppShell';
import AuthLayout from '../../../../../components/AuthLayout';
import {
  Alert,
  Button,
  DocumentStatusBadge,
  EmptyState,
  Field,
  IntegrityBadge,
  SignatureStatusBadge,
  VerificationResultBadge,
} from '../../../../../components/ui';

const CHECK_LABELS = {
  hashCheck: 'Content hash matches',
  signatureCheck: 'Signature is cryptographically valid',
  ledgerCheck: 'Audit ledger is intact',
  versionCheck: 'This is the current version',
};

export default function DocumentViewerPage() {
  const { id: caseId, documentId } = useParams();
  const { user, loading } = useAuth();

  const [doc, setDoc] = useState(null);
  const [versions, setVersions] = useState([]);
  const [comments, setComments] = useState([]);
  const [members, setMembers] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [myKey, setMyKey] = useState(null);
  const [error, setError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [commentBody, setCommentBody] = useState('');
  const [busyVersionId, setBusyVersionId] = useState(null);

  const [signReason, setSignReason] = useState('');
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ toUserId: '', reason: '' });

  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [d, v, c] = await Promise.all([
        apiJson(`/documents/${documentId}`),
        apiJson(`/documents/${documentId}/versions`),
        apiJson(`/documents/${documentId}/comments`),
      ]);
      setDoc(d);
      setVersions(v);
      setComments(c);
      setError(null);

      const [sigs, mems] = await Promise.all([
        apiJson(`/signatures/documents/${documentId}`),
        apiJson(`/cases/${d.case_id}/members`),
      ]);
      setSignatures(sigs);
      setMembers(mems);
    } catch (err) {
      setError(err.message || 'Failed to load document.');
    }
    try {
      setMyKey(await apiJson('/signatures/keys/me'));
    } catch {
      setMyKey(null); // 404 = no active key yet, not a real error
    }
  }, [documentId]);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  async function handleDownload(versionId) {
    setDownloadError(null);
    setBusyVersionId(versionId || 'current');
    try {
      const path = versionId
        ? `/documents/${documentId}/versions/${versionId}/download`
        : `/documents/${documentId}/download`;
      const { blob, filename } = await apiBlob(path);
      // The sandbox blocks script-driven saves, so this just opens the
      // decrypted file in a new tab rather than triggering a save.
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      void filename;
    } catch (err) {
      setDownloadError(
        err.code === 'INTEGRITY_FAILURE'
          ? 'Integrity check failed — this content no longer matches its recorded hash. Download blocked.'
          : err.message || 'Download failed.',
      );
    } finally {
      setBusyVersionId(null);
    }
  }

  async function handleRestore(versionId) {
    try {
      await apiJson(`/documents/${documentId}/versions/${versionId}/restore`, { method: 'POST' });
      refresh();
    } catch (err) {
      setError(err.message || 'Restore failed.');
    }
  }

  async function handleAddComment(e) {
    e.preventDefault();
    try {
      await apiJson(`/documents/${documentId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody }),
      });
      setCommentBody('');
      refresh();
    } catch (err) {
      setError(err.message || 'Failed to add comment.');
    }
  }

  async function handleGenerateKey() {
    setSignError(null);
    try {
      setMyKey(await apiJson('/signatures/keys', { method: 'POST' }));
    } catch (err) {
      setSignError(err.message || 'Failed to generate a signing key.');
    }
  }

  async function handleSelfSign(e) {
    e.preventDefault();
    setSignError(null);
    setSignBusy(true);
    try {
      await apiJson(`/signatures/documents/${documentId}/sign`, {
        method: 'POST',
        body: JSON.stringify({ reason: signReason || undefined }),
      });
      setSignReason('');
      refresh();
    } catch (err) {
      setSignError(err.message || 'Signing failed.');
    } finally {
      setSignBusy(false);
    }
  }

  async function handleRequestSignature(e) {
    e.preventDefault();
    setSignError(null);
    setSignBusy(true);
    try {
      await apiJson(`/signatures/documents/${documentId}/request`, {
        method: 'POST',
        body: JSON.stringify(requestForm),
      });
      setRequestForm({ toUserId: '', reason: '' });
      setShowRequestForm(false);
      refresh();
    } catch (err) {
      setSignError(err.message || 'Requesting a signature failed.');
    } finally {
      setSignBusy(false);
    }
  }

  async function handleVerify() {
    setVerifyError(null);
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await apiJson(`/verification/documents/${documentId}`));
    } catch (err) {
      setVerifyError(err.message || 'Verification failed.');
    } finally {
      setVerifyBusy(false);
    }
  }

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view this document.
        </p>
      </AuthLayout>
    );
  }
  if (error && !doc) {
    return (
      <AppShell>
        <div className="page">
          <Alert>{error}</Alert>
          <Link href={`/cases/${caseId}`}>← Back to case</Link>
        </div>
      </AppShell>
    );
  }
  if (!doc) return <div className="skeleton-page">Loading document…</div>;

  return (
    <AppShell>
      <div className="page">
        <Link href={`/cases/${caseId}`} className="text-sm muted">
          ← Back to case
        </Link>

        <div className="page-header" style={{ marginTop: 8 }}>
          <div>
            <h1>{doc.title}</h1>
            <div className="row" style={{ marginTop: 4 }}>
              <DocumentStatusBadge status={doc.status} />
            </div>
          </div>
          <Button onClick={() => handleDownload()} disabled={busyVersionId === 'current'}>
            {busyVersionId === 'current' ? 'Decrypting…' : '⬇ Download current version'}
          </Button>
        </div>

        {doc.description && <p className="muted">{doc.description}</p>}
        <Alert>{downloadError}</Alert>

        <div className="section">
          <h2>Version history</h2>
          {versions.length === 0 ? (
            <EmptyState>No versions.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>File</th>
                    <th>Integrity</th>
                    <th>Uploaded by</th>
                    <th>Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => {
                    const isCurrent = v.id === doc.current_version_id;
                    return (
                      <tr key={v.id}>
                        <td>
                          <strong>{v.version_number}</strong>
                          {isCurrent && (
                            <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                              current
                            </span>
                          )}
                        </td>
                        <td className="muted">{v.file_name}</td>
                        <td>
                          <IntegrityBadge status={v.integrity_status} />
                        </td>
                        <td>{v.created_by_username}</td>
                        <td className="muted">{v.change_note || '—'}</td>
                        <td>
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownload(v.id)}
                              disabled={busyVersionId === v.id}
                            >
                              {busyVersionId === v.id ? '…' : 'Download'}
                            </Button>
                            {!isCurrent && (
                              <Button size="sm" variant="ghost" onClick={() => handleRestore(v.id)}>
                                Restore
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section">
          <h2>Signatures &amp; verification</h2>

          {!myKey && (
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              You don't have a signing key yet.{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleGenerateKey}>
                Generate one now
              </button>
            </div>
          )}

          {signatures.length === 0 ? (
            <EmptyState>Not signed yet.</EmptyState>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Signer</th>
                    <th>Status</th>
                    <th>Requested by</th>
                    <th>Signed at</th>
                    <th>Verification code</th>
                  </tr>
                </thead>
                <tbody>
                  {signatures.map((s) => (
                    <tr key={s.id}>
                      <td>{s.signer_username}</td>
                      <td>
                        <SignatureStatusBadge status={s.status} />
                      </td>
                      <td className="muted">{s.requested_by_username || 'self'}</td>
                      <td className="muted">{s.signed_at ? new Date(s.signed_at).toLocaleString() : '—'}</td>
                      <td className="muted">
                        {s.verification_code ? (
                          <Link href={`/verify/${s.verification_code}`}>{s.verification_code.slice(0, 10)}…</Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <form onSubmit={handleSelfSign} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ minWidth: 220 }}
                placeholder="Signing reason (optional)"
                value={signReason}
                onChange={(e) => setSignReason(e.target.value)}
              />
              <Button type="submit" disabled={signBusy || !myKey}>
                {signBusy ? '…' : 'Sign now'}
              </Button>
            </form>

            <Button
              variant={showRequestForm ? 'outline' : 'secondary'}
              onClick={() => setShowRequestForm((v) => !v)}
            >
              {showRequestForm ? 'Cancel' : 'Request a signature'}
            </Button>
          </div>

          {showRequestForm && (
            <form onSubmit={handleRequestSignature} className="form-grid card card-tint" style={{ marginTop: 12 }}>
              <Field label="Signer">
                <select
                  className="input"
                  value={requestForm.toUserId}
                  onChange={(e) => setRequestForm({ ...requestForm, toUserId: e.target.value })}
                  required
                >
                  <option value="">— choose a case member —</option>
                  {members
                    .filter((m) => m.user_id !== user.id)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.username} ({m.case_role})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Reason">
                <input
                  className="input"
                  value={requestForm.reason}
                  onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
                  placeholder="e.g. Please review and sign"
                />
              </Field>
              <Button type="submit" disabled={signBusy}>
                Send request
              </Button>
            </form>
          )}

          <Alert>{signError}</Alert>

          <div className="card card-tint" style={{ marginTop: 20 }}>
            <div className="card-header">
              <h3 style={{ margin: 0 }}>Four-check verification</h3>
              <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifyBusy}>
                {verifyBusy ? 'Checking…' : 'Verify authenticity'}
              </Button>
            </div>
            <Alert>{verifyError}</Alert>
            {verifyResult && (
              <div style={{ marginTop: 8 }}>
                <VerificationResultBadge status={verifyResult.status} />
                {verifyResult.checks && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                    {Object.entries(verifyResult.checks).map(([key, passed]) => (
                      <li
                        key={key}
                        className="text-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
                      >
                        <span
                          style={{ color: passed ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}
                        >
                          {passed ? '✓' : '✗'}
                        </span>
                        {CHECK_LABELS[key] || key}
                      </li>
                    ))}
                  </ul>
                )}
                {verifyResult.verificationCode && (
                  <p className="text-sm muted" style={{ marginTop: 10, marginBottom: 0 }}>
                    Public verification link:{' '}
                    <Link href={`/verify/${verifyResult.verificationCode}`}>
                      /verify/{verifyResult.verificationCode}
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <h2>Comments</h2>
          {comments.length === 0 ? (
            <EmptyState>No comments yet.</EmptyState>
          ) : (
            <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
              {comments.map((c) => (
                <div key={c.id} className="card" style={{ padding: '12px 16px' }}>
                  <div className="text-sm" style={{ fontWeight: 700, color: 'var(--color-slate)' }}>
                    {c.author_username}
                  </div>
                  <div>{c.body}</div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddComment} className="row">
            <input
              className="input"
              style={{ flex: 1 }}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add a comment…"
              required
            />
            <Button type="submit" variant="secondary">
              Comment
            </Button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
