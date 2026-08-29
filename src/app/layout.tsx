import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solvantis',
  description: 'Multichannel POS, inventory, ecommerce, and retail intelligence.',
  icons: {
    icon: [
      { url: '/brand/solvantis-favicon.svg?v=20260822', type: 'image/svg+xml' },
      { url: '/brand/png/solvantis-icon-32.png?v=20260822', type: 'image/png', sizes: '32x32' },
    ],
    apple: [{ url: '/brand/png/solvantis-icon-192.png?v=20260822', sizes: '192x192', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
