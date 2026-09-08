export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Secure DMS</h1>
      <p>Secure Digital Document Management System — SIH 2026.</p>
      <ul>
        <li>
          <a href="/login">Sign in</a>
        </li>
        <li>
          <a href="/cases">Cases</a>
        </li>
        <li>
          <a href="/admin/users">User management (admin)</a>
        </li>
      </ul>
    </main>
  );
}
