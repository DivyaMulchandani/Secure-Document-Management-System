export default function HomePage() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api/v1';

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Secure DMS</h1>
      <p>Sprint 0 placeholder page — the module skeleton and middleware chain are wired up.</p>
      <p>
        API base URL: <code>{apiBaseUrl}</code>
      </p>
    </main>
  );
}
