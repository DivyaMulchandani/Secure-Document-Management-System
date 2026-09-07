import { AuthProvider } from '../lib/auth-context';

export const metadata = {
  title: 'Secure DMS',
  description: 'Secure Digital Document Management System — SIH 2026',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
