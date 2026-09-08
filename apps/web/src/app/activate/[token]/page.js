'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiJson } from '../../../lib/api-client';
import AuthLayout from '../../../components/AuthLayout';
import { Alert, Button, Field, Badge } from '../../../components/ui';

export default function ActivatePage() {
  const { token } = useParams();
  const router = useRouter();

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiJson(`/users/activate/${token}`);
        setPreview(data);
      } catch (err) {
        setPreviewError(err.message || 'This invitation link is invalid or has expired.');
      }
    })();
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await apiJson(`/users/activate/${token}`, {
        method: 'POST',
        body: JSON.stringify({ password, fullName }),
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      setError(err.message || 'Activation failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (previewError) {
    return (
      <AuthLayout title="Activate account">
        <Alert>{previewError}</Alert>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Account activated">
        <Alert tone="success">
          Redirecting to <a href="/login">login</a>…
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Activate account"
      subtitle={
        preview ? (
          <>
            Invited as <strong>{preview.email}</strong>{' '}
            <Badge tone="pink">{preview.roleName}</Badge>
            {preview.departmentName ? ` · ${preview.departmentName}` : ''}
          </>
        ) : (
          'Checking your invitation…'
        )
      }
    >
      <form onSubmit={handleSubmit} className="stack" style={{ gap: 14 }}>
        <Field label="Full name">
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm password">
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>

        <Alert>{error}</Alert>

        <Button type="submit" disabled={submitting || !preview} style={{ width: '100%', marginTop: 4 }}>
          {submitting ? 'Activating…' : 'Activate account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
