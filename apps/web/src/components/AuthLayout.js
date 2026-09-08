'use client';

/**
 * Full-height branded frame for unauthenticated screens (login,
 * activation) — a centered card over a gradient built from the brand
 * colors, distinct from AppShell's plain top-nav app frame.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-frame">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark" />
          Secure DMS
        </div>
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>

      <style jsx global>{`
        .auth-frame {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: radial-gradient(circle at 15% 15%, #4a1a8f 0%, var(--color-midnight) 38%, var(--color-slate) 100%);
        }
        .auth-card {
          width: 100%;
          max-width: 400px;
          background: var(--color-surface);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          padding: 36px 32px 32px;
        }
        .auth-brand {
          display: flex;
          align-items: center;
          gap: 9px;
          font-family: var(--font-serif);
          font-weight: 600;
          font-size: 15px;
          color: var(--color-slategray);
          margin-bottom: 22px;
        }
        .auth-brand-mark {
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: var(--color-pink);
        }
        .auth-title {
          font-size: 24px;
          margin-bottom: 2px;
        }
        .auth-subtitle {
          color: var(--color-text-muted);
          font-size: 13.5px;
          margin-bottom: 22px;
        }
        .auth-footer {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--color-border);
          font-size: 13px;
          color: var(--color-text-muted);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
