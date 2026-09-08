'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthLayout from '../../components/AuthLayout';
import { Button, Field } from '../../components/ui';

/**
 * The external-verifier entry point — no login required. Anyone holding
 * a document's verification code (printed on it, or shared as a link)
 * lands here first, types/pastes the code, and is taken to
 * /verify/[code] which actually runs the four checks.
 */
export default function VerifyEntryPage() {
  const router = useRouter();
  const [code, setCode] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed) router.push(`/verify/${encodeURIComponent(trimmed)}`);
  }

  return (
    <AuthLayout
      title="Verify a document"
      subtitle="Enter the verification code printed on a signed document to confirm it's authentic and unaltered."
    >
      <form onSubmit={handleSubmit} className="stack" style={{ gap: 14 }}>
        <Field label="Verification code">
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 3f9a1c2b4d5e6f708192"
            autoFocus
            required
          />
        </Field>
        <Button type="submit">Verify</Button>
      </form>
    </AuthLayout>
  );
}
