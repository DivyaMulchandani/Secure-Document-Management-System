'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api-client';
import AuthLayout from '../../../components/AuthLayout';
import { VerificationResultBadge } from '../../../components/ui';

const CHECK_LABELS = {
  hashCheck: 'Content hash matches',
  signatureCheck: 'Signature is cryptographically valid',
  ledgerCheck: 'Audit ledger is intact',
  versionCheck: 'This is the current version',
};

const STATUS_MESSAGE = {
  AUTHENTIC: 'This document is authentic and unaltered.',
  TAMPERED: 'This document failed verification — it may have been altered after signing.',
  SUPERSEDED: 'This signature is genuine, but the document has a newer version since it was signed.',
  NOT_FOUND: "No document was found for this verification code — double-check it's correct.",
};

/**
 * The external-verifier path itself — public, unauthenticated. Runs the
 * same four checks as the internal portal (GET /verification/documents/
 * :id) against a document identified purely by its shareable
 * verification code, and shows nothing beyond what's needed to
 * establish authenticity (no case/document ids, no file content).
 */
export default function PublicVerifyPage() {
  const { code } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/verification/public/${encodeURIComponent(code)}`);
        const data = await res.json();
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setError('Could not reach the verification service. Try again shortly.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <AuthLayout title="Verify a document">
        <p className="muted">{error}</p>
      </AuthLayout>
    );
  }
  if (!result) {
    return (
      <AuthLayout title="Verify a document">
        <p className="muted">Checking…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Verification result"
      subtitle={`Code: ${code}`}
      footer={<Link href="/verify">← Verify another document</Link>}
    >
      <div style={{ marginBottom: 16 }}>
        <VerificationResultBadge status={result.status} />
      </div>
      <p className="muted text-sm" style={{ marginTop: 0 }}>
        {STATUS_MESSAGE[result.status] || 'Could not determine this document’s status.'}
      </p>

      {result.status !== 'NOT_FOUND' && (
        <>
          <div className="card card-tint" style={{ marginTop: 16, marginBottom: 16 }}>
            <div className="text-sm">
              <strong>{result.documentTitle}</strong>
            </div>
            <div className="text-sm muted" style={{ marginTop: 4 }}>
              Version {result.versionNumber} · signed by {result.signerUsername}
              {result.signedAt ? ` on ${new Date(result.signedAt).toLocaleString()}` : ''}
            </div>
          </div>

          {result.checks && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {Object.entries(result.checks).map(([key, passed]) => (
                <li
                  key={key}
                  className="text-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
                >
                  <span style={{ color: passed ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                    {passed ? '✓' : '✗'}
                  </span>
                  {CHECK_LABELS[key] || key}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AuthLayout>
  );
}
