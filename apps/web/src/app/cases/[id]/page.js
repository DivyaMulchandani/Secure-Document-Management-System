'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CASE_ROLE_LIST } from '@secure-dms/shared';
import { useAuth } from '../../../lib/auth-context';
import { apiJson, apiFetch } from '../../../lib/api-client';

export default function CaseWorkspacePage() {
  const { id: caseId } = useParams();
  const { user, loading } = useAuth();

  const [caseData, setCaseData] = useState(null);
  const [caseError, setCaseError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [members, setMembers] = useState([]);

  const [uploadForm, setUploadForm] = useState({ title: '', description: '', documentTypeId: '' });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [memberForm, setMemberForm] = useState({ userId: '', caseRole: CASE_ROLE_LIST[0] });
  const [memberError, setMemberError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [c, docs, members_] = await Promise.all([
        apiJson(`/cases/${caseId}`),
        apiJson(`/documents?caseId=${caseId}`),
        apiJson(`/cases/${caseId}/members`),
      ]);
      setCaseData(c);
      setDocuments(docs);
      setMembers(members_);
      setCaseError(null);
    } catch (err) {
      setCaseError(err.message || 'Failed to load case.');
    }
  }, [caseId]);

  useEffect(() => {
    if (user) {
      refresh();
      apiJson('/documents/types').then(setDocTypes).catch(() => {});
    }
  }, [user, refresh]);

  async function handleUpload(e) {
    e.preventDefault();
    setUploadError(null);
    if (!uploadFile) {
      setUploadError('Choose a file first.');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('caseId', caseId);
      body.append('title', uploadForm.title);
      if (uploadForm.description) body.append('description', uploadForm.description);
      if (uploadForm.documentTypeId) body.append('documentTypeId', uploadForm.documentTypeId);
      body.append('file', uploadFile);

      const res = await apiFetch('/documents', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Upload failed.');

      if (data.duplicateOf?.length) {
        setUploadError(
          `Uploaded, but this content matches an existing document: "${data.duplicateOf[0].document_title}".`,
        );
      }
      setUploadForm({ title: '', description: '', documentTypeId: '' });
      setUploadFile(null);
      refresh();
    } catch (err) {
      setUploadError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    setMemberError(null);
    try {
      await apiJson(`/cases/${caseId}/members`, { method: 'POST', body: JSON.stringify(memberForm) });
      setMemberForm({ userId: '', caseRole: CASE_ROLE_LIST[0] });
      refresh();
    } catch (err) {
      setMemberError(err.message || 'Failed to add member.');
    }
  }

  async function handleAdvanceStatus(status) {
    try {
      await apiJson(`/cases/${caseId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      refresh();
    } catch (err) {
      setCaseError(err.message || 'Failed to update status.');
    }
  }

  if (loading) return <main style={{ padding: '2rem' }}>Loading…</main>;
  if (!user) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <p>
          <a href="/login">Sign in</a> to view this case.
        </p>
      </main>
    );
  }
  if (caseError && !caseData) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <p style={{ color: 'crimson' }}>{caseError}</p>
        <p>
          <Link href="/cases">Back to cases</Link>
        </p>
      </main>
    );
  }
  if (!caseData) return <main style={{ padding: '2rem' }}>Loading case…</main>;

  const NEXT_STATUS = {
    OPEN: 'UNDER_INVESTIGATION',
    UNDER_INVESTIGATION: 'UNDER_REVIEW',
    UNDER_REVIEW: 'SUBMITTED',
    SUBMITTED: 'CLOSED',
    CLOSED: 'ARCHIVED',
  }[caseData.status];

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <p>
        <Link href="/cases">← All cases</Link>
      </p>
      <h1>
        {caseData.case_number} — {caseData.title}
      </h1>
      <p>
        Status: <strong>{caseData.status}</strong> · Priority: {caseData.priority}
        {NEXT_STATUS && (
          <button style={{ marginLeft: '1rem' }} onClick={() => handleAdvanceStatus(NEXT_STATUS)}>
            Advance to {NEXT_STATUS}
          </button>
        )}
      </p>
      {caseData.description && <p>{caseData.description}</p>}
      {caseError && <p style={{ color: 'crimson' }}>{caseError}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Upload document</h2>
        <form onSubmit={handleUpload} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label>
            Title
            <input
              value={uploadForm.title}
              onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
              required
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Type
            <select
              value={uploadForm.documentTypeId}
              onChange={(e) => setUploadForm({ ...uploadForm, documentTypeId: e.target.value })}
              style={{ display: 'block' }}
            >
              <option value="">—</option>
              {docTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            File
            <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} required style={{ display: 'block' }} />
          </label>
          <button type="submit" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
        {uploadError && <p style={{ color: 'crimson' }}>{uploadError}</p>}
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Documents</h2>
        <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Version</th>
              <th>Integrity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/cases/${caseId}/documents/${d.id}`}>{d.title}</Link>
                </td>
                <td>{d.document_type_name || '—'}</td>
                <td>{d.current_version_number}</td>
                <td>{d.current_integrity_status}</td>
                <td>{d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Case members</h2>
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              {m.username} — {m.case_role}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddMember} style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
          <label>
            User ID
            <input
              value={memberForm.userId}
              onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })}
              placeholder="uuid"
              required
              style={{ display: 'block' }}
            />
          </label>
          <label>
            Case role
            <select
              value={memberForm.caseRole}
              onChange={(e) => setMemberForm({ ...memberForm, caseRole: e.target.value })}
              style={{ display: 'block' }}
            >
              {CASE_ROLE_LIST.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add member</button>
        </form>
        {memberError && <p style={{ color: 'crimson' }}>{memberError}</p>}
      </section>
    </main>
  );
}
