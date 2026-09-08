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
  IntegrityBadge,
} from '../../../../../components/ui';

export default function DocumentViewerPage() {
  const { id: caseId, documentId } = useParams();
  const { user, loading } = useAuth();

  const [doc, setDoc] = useState(null);
  const [versions, setVersions] = useState([]);
  const [comments, setComments] = useState([]);
  const [error, setError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [commentBody, setCommentBody] = useState('');
  const [busyVersionId, setBusyVersionId] = useState(null);

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
    } catch (err) {
      setError(err.message || 'Failed to load document.');
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
