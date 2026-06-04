import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Shield Account',
  description: 'Manage your Shield Low Voltage monitoring subscription and payment methods.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#f1f5f9' }}>
        {children}
      </body>
    </html>
  );
}
