'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CASE_ROLE_LIST } from '@secure-dms/shared';
import { useAuth } from '../../../lib/auth-context';
import { apiJson, apiFetch } from '../../../lib/api-client';
import AppShell from '../../../components/AppShell';
import AuthLayout from '../../../components/AuthLayout';
import {
  Alert,
  Badge,
  Button,
  CaseStatusBadge,
  DocumentStatusBadge,
  EmptyState,
  Field,
  IntegrityBadge,
  PriorityBadge,
} from '../../../components/ui';

const NEXT_STATUS_MAP = {
  OPEN: 'UNDER_INVESTIGATION',
  UNDER_INVESTIGATION: 'UNDER_REVIEW',
  UNDER_REVIEW: 'SUBMITTED',
  SUBMITTED: 'CLOSED',
  CLOSED: 'ARCHIVED',
};

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
  const [uploadNotice, setUploadNotice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const [memberForm, setMemberForm] = useState({ userId: '', caseRole: CASE_ROLE_LIST[0] });
  const [memberError, setMemberError] = useState(null);
  const [showMemberForm, setShowMemberForm] = useState(false);

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
      apiJson('/documents/types')
        .then(setDocTypes)
        .catch(() => {});
    }
  }, [user, refresh]);

  async function handleUpload(e) {
    e.preventDefault();
    setUploadError(null);
    setUploadNotice(null);
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
        setUploadNotice(
          `Uploaded — heads up, this content matches an existing document: "${data.duplicateOf[0].document_title}".`,
        );
      }
      setUploadForm({ title: '', description: '', documentTypeId: '' });
      setUploadFile(null);
      setShowUpload(false);
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
      setShowMemberForm(false);
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

  if (loading) return <div className="skeleton-page">Loading…</div>;
  if (!user) {
    return (
      <AuthLayout title="Sign in required">
        <p className="muted">
          <a href="/login">Sign in</a> to view this case.
        </p>
      </AuthLayout>
    );
  }
  if (caseError && !caseData) {
    return (
      <AppShell>
        <div className="page">
          <Alert>{caseError}</Alert>
          <Link href="/cases">← Back to cases</Link>
        </div>
      </AppShell>
    );
  }
  if (!caseData) return <div className="skeleton-page">Loading case…</div>;

  const nextStatus = NEXT_STATUS_MAP[caseData.status];

  return (
    <AppShell>
      <div className="page">
        <Link href="/cases" className="text-sm muted">
          ← All cases
        </Link>

        <div className="page-header" style={{ marginTop: 8 }}>
          <div>
            <h1>
              <span className="muted" style={{ fontWeight: 400, fontSize: 18 }}>
                {caseData.case_number}
              </span>
              <br />
              {caseData.title}
            </h1>
            <div className="row" style={{ marginTop: 6 }}>
              <CaseStatusBadge status={caseData.status} />
              <PriorityBadge priority={caseData.priority} />
            </div>
          </div>
          {nextStatus && (
            <Button variant="outline" onClick={() => handleAdvanceStatus(nextStatus)}>
              Advance → {nextStatus}
            </Button>
          )}
        </div>

        {caseData.description && <p className="muted">{caseData.description}</p>}
        <Alert>{caseError}</Alert>

        <div className="section">
          <div className="card-header">
            <h2>Documents</h2>
            <Button size="sm" variant={showUpload ? 'outline' : 'secondary'} onClick={() => setShowUpload((v) => !v)}>
              {showUpload ? 'Cancel' : '+ Upload document'}
            </Button>
          </div>

          {showUpload && (
            <div className="card card-tint" style={{ marginBottom: 16 }}>
              <form onSubmit={handleUpload} className="form-grid">
                <Field label="Title">
                  <input
                    className="input"
                    value={uploadForm.title}
                    onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Type">
                  <select
                    className="input"
                    value={uploadForm.documentTypeId}
                    onChange={(e) => setUploadForm({ ...uploadForm, documentTypeId: e.target.value })}
                  >
                    <option value="">—</option>
                    {docTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="File">
                  <input
                    className="input"
                    type="file"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    required
                  />
                </Field>
                <Button type="submit" disabled={uploading}>
                  {uploading ? 'Encrypting & uploading…' : 'Upload'}
                </Button>
              </form>
              <Alert>{uploadError}</Alert>
              <Alert tone="success">{uploadNotice}</Alert>
            </div>
          )}

          {documents.length === 0 ? (
            <EmptyState>No documents uploaded to this case yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
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
                        <Link href={`/cases/${caseId}/documents/${d.id}`}>
                          <strong>{d.title}</strong>
                        </Link>
                      </td>
                      <td className="muted">{d.document_type_name || '—'}</td>
                      <td>{d.current_version_number}</td>
                      <td>
                        <IntegrityBadge status={d.current_integrity_status} />
                      </td>
                      <td>
                        <DocumentStatusBadge status={d.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section">
          <div className="card-header">
            <h2>Case members</h2>
            <Button
              size="sm"
              variant={showMemberForm ? 'outline' : 'secondary'}
              onClick={() => setShowMemberForm((v) => !v)}
            >
              {showMemberForm ? 'Cancel' : '+ Add member'}
            </Button>
          </div>

          {members.length === 0 ? (
            <EmptyState>No members yet.</EmptyState>
          ) : (
            <div className="row" style={{ marginBottom: showMemberForm ? 16 : 0 }}>
              {members.map((m) => (
                <span key={m.id} className="row" style={{ gap: 6 }}>
                  <Badge>{m.username}</Badge>
                  <Badge tone="accent">{m.case_role}</Badge>
                </span>
              ))}
            </div>
          )}

          {showMemberForm && (
            <form onSubmit={handleAddMember} className="form-grid card card-tint">
              <Field label="User ID">
                <input
                  className="input"
                  value={memberForm.userId}
                  onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })}
                  placeholder="uuid"
                  required
                />
              </Field>
              <Field label="Case role">
                <select
                  className="input"
                  value={memberForm.caseRole}
                  onChange={(e) => setMemberForm({ ...memberForm, caseRole: e.target.value })}
                >
                  {CASE_ROLE_LIST.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit">Add member</Button>
              <Alert>{memberError}</Alert>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
