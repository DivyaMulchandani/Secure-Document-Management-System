'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { apiJson, apiBlob } from '../../../../../lib/api-client';

export default function DocumentViewerPage() {
  const { id: caseId, documentId } = useParams();
  const { user, loading } = useAuth();

  const [doc, setDoc] = useState(null);
  const [versions, setVersions] = useState([]);
  const [comments, setComments] = useState([]);
  const [error, setError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [commentBody, setCommentBody] = useState('');

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
    try {
      const path = versionId ? `/documents/${documentId}/versions/${versionId}/download` : `/documents/${documentId}/download`;
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
      await apiJson(`/documents/${documentId}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody }) });
      setCommentBody('');
      refresh();
    } catch (err) {
      setError(err.message || 'Failed to add comment.');
    }
  }

  if (loading) return <main style={{ padding: '2rem' }}>Loading…</main>;
  if (!user) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <p>
          <a href="/login">Sign in</a> to view this document.
        </p>
      </main>
    );
  }
  if (error && !doc) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <p style={{ color: 'crimson' }}>{error}</p>
        <p>
          <Link href={`/cases/${caseId}`}>← Back to case</Link>
        </p>
      </main>
    );
  }
  if (!doc) return <main style={{ padding: '2rem' }}>Loading document…</main>;

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <p>
        <Link href={`/cases/${caseId}`}>← Back to case</Link>
      </p>
      <h1>{doc.title}</h1>
      <p>
        Status: <strong>{doc.status}</strong>
      </p>
      {doc.description && <p>{doc.description}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <button onClick={() => handleDownload()}>Download current version</button>
        {downloadError && <p style={{ color: 'crimson' }}>{downloadError}</p>}
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Version history</h2>
        <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Version</th>
              <th>File</th>
              <th>Integrity</th>
              <th>Uploaded by</th>
              <th>Note</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} style={v.id === doc.current_version_id ? { fontWeight: 'bold' } : undefined}>
                <td>{v.version_number}</td>
                <td>{v.file_name}</td>
                <td>{v.integrity_status}</td>
                <td>{v.created_by_username}</td>
                <td>{v.change_note || '—'}</td>
                <td style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => handleDownload(v.id)}>Download</button>
                  {v.id !== doc.current_version_id && (
                    <button onClick={() => handleRestore(v.id)}>Restore</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Comments</h2>
        <ul>
          {comments.map((c) => (
            <li key={c.id}>
              <strong>{c.author_username}</strong>: {c.body}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddComment} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment…"
            required
            style={{ flex: 1 }}
          />
          <button type="submit">Comment</button>
        </form>
      </section>
    </main>
  );
}
