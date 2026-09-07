'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiJson } from '../../../lib/api-client';

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
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <h1>Activate account</h1>
        <p style={{ color: 'crimson' }}>{previewError}</p>
      </main>
    );
  }

  if (done) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <h1>Account activated</h1>
        <p>
          Redirecting to <a href="/login">login</a>…
        </p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 360 }}>
      <h1>Activate account</h1>
      {preview && (
        <p>
          Invited as <strong>{preview.email}</strong> ({preview.roleName}
          {preview.departmentName ? `, ${preview.departmentName}` : ''})
        </p>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          Full name
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" disabled={submitting || !preview}>
          {submitting ? 'Activating…' : 'Activate account'}
        </button>
      </form>
    </main>
  );
}
