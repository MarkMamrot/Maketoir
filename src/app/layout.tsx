import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solvantis',
  description: 'AI-driven marketing platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-skin="dark" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var skin = localStorage.getItem('solvantis_ui_skin') || 'dark';
                  document.documentElement.setAttribute('data-skin', skin === 'default' ? 'default' : 'dark');
                } catch (e) {
                  document.documentElement.setAttribute('data-skin', 'dark');
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
