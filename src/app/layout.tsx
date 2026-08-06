import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solvantis',
  description: 'Multichannel POS, inventory, ecommerce, and retail intelligence.',
  icons: {
    icon: [
      { url: '/brand/solvantis-favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/png/solvantis-icon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: [{ url: '/brand/png/solvantis-icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-skin="default" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var skin = localStorage.getItem('solvantis_ui_skin') || 'default';
                  document.documentElement.setAttribute('data-skin', skin === 'dark' ? 'dark' : 'default');
                } catch (e) {
                  document.documentElement.setAttribute('data-skin', 'default');
                }
              })();
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
