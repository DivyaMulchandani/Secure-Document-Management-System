'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

/**
 * Top navigation + content frame for every authenticated screen (cases,
 * document viewer, admin). Reads auth state itself so pages don't have
 * to thread it through — just wrap a page's content in <AppShell>.
 */
export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  const isAdmin = !!user && user.roles.includes('ADMINISTRATOR');
  const navLink = (href, label) => (
    <Link href={href} className={`nav-link${pathname.startsWith(href) ? ' nav-link-active' : ''}`}>
      {label}
    </Link>
  );

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-header-inner">
          <Link href="/cases" className="brand">
            <span className="brand-mark" />
            Secure DMS
          </Link>

          {user && (
            <nav className="row" style={{ gap: 4 }}>
              {navLink('/cases', 'Cases')}
              {isAdmin && navLink('/admin/users', 'Users')}
            </nav>
          )}

          <div className="spacer" />

          {user ? (
            <div className="row">
              <div className="shell-user">
                <span className="shell-user-name">{user.fullName || user.username}</span>
                <span className="shell-user-role">{user.roles.join(', ')}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main>{children}</main>

      <style jsx global>{`
        .shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .shell-header {
          background: var(--color-slate);
          border-bottom: 1px solid var(--color-midnight-strong);
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .shell-header-inner {
          max-width: 1080px;
          margin: 0 auto;
          padding: 0 24px;
          height: 60px;
          display: flex;
          align-items: center;
          gap: 28px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 9px;
          font-family: var(--font-serif);
          font-weight: 600;
          font-size: 17px;
          color: #fff;
        }
        .brand:hover {
          text-decoration: none;
          opacity: 0.9;
        }
        .brand-mark {
          width: 11px;
          height: 11px;
          border-radius: 3px;
          background: var(--color-pink);
          box-shadow: 0 0 0 3px rgba(232, 184, 192, 0.28);
        }
        .nav-link {
          color: rgba(248, 247, 252, 0.72);
          font-size: 13.5px;
          font-weight: 600;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
        }
        .nav-link:hover {
          color: #fff;
          text-decoration: none;
          background: rgba(255, 255, 255, 0.08);
        }
        .nav-link-active {
          color: #fff;
          background: rgba(179, 161, 227, 0.22);
        }
        .shell-user {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          line-height: 1.25;
        }
        .shell-user-name {
          color: #fff;
          font-size: 13px;
          font-weight: 600;
        }
        .shell-user-role {
          color: var(--color-pink);
          font-size: 10.5px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}
