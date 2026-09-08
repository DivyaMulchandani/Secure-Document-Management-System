'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import AuthLayout from '../../components/AuthLayout';
import { Alert, Button, Field } from '../../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(username, password, otp || undefined);
      router.push(user.roles.includes('ADMINISTRATOR') ? '/admin/users' : '/cases');
    } catch (err) {
      if (err.code === 'ACCOUNT_LOCKED') {
        setError('This account is locked. Contact an administrator.');
      } else if (err.code === 'INVALID_CREDENTIALS') {
        setError('Invalid username, password, or code.');
      } else {
        setError(err.message || 'Login failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Secure access for investigators, forensic officers, prosecutors, and administrators."
      footer="Invited to a case? Use the activation link from your email to set a password first."
    >
      <form onSubmit={handleSubmit} className="stack" style={{ gap: 14 }}>
        <Field label="Username">
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field label="6-digit code (only if MFA is enabled)">
          <input
            className="input"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            maxLength={6}
            placeholder="••••••"
          />
        </Field>

        <Alert>{error}</Alert>

        <Button type="submit" disabled={submitting} style={{ width: '100%', marginTop: 4 }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
