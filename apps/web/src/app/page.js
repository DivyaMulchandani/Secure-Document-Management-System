'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth-context';
import AppShell from '../components/AppShell';
import { Button } from '../components/ui';

export default function HomePage() {
  const { user, loading } = useAuth();

  return (
    <AppShell>
      <div className="landing">
        <div className="landing-inner">
          <span className="badge badge-pink" style={{ marginBottom: 16 }}>
            SIH 2026 · Secure DMS
          </span>
          <h1 style={{ fontSize: 38, color: '#fff', marginBottom: 10 }}>
            Secure Digital Document Management
          </h1>
          <p style={{ color: 'rgba(248,247,252,0.78)', fontSize: 16, maxWidth: 560, margin: '0 auto 28px' }}>
            Encrypted storage, hash-verified integrity, a three-layer permission engine, and a
            tamper-evident audit ledger for legal &amp; investigation case files.
          </p>

          {!loading && (
            <div className="row" style={{ justifyContent: 'center' }}>
              {user ? (
                <Link href="/cases">
                  <Button variant="secondary">Go to cases →</Button>
                </Link>
              ) : (
                <Link href="/login">
                  <Button variant="secondary">Sign in →</Button>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .landing {
          min-height: calc(100vh - 60px);
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 80% 20%, #4a1a8f 0%, var(--color-midnight) 45%, var(--color-slate) 100%);
          padding: 40px 24px;
        }
        .landing-inner {
          text-align: center;
        }
      `}</style>
    </AppShell>
  );
}
