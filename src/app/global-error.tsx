'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/runtime-issues/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: error.name,
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        pathname: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' }}>
        <main style={{ width: 'min(440px,calc(100vw - 32px))', border: '1px solid rgba(255,255,255,.14)', background: '#1e293b', padding: 24, borderRadius: 8 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>Something went wrong</h1>
          <p style={{ margin: '0 0 18px', color: '#94a3b8', lineHeight: 1.5, fontSize: 14 }}>The error has been recorded for review.</p>
          <button onClick={reset} style={{ border: 0, borderRadius: 6, background: '#2563eb', color: '#fff', padding: '9px 14px', fontWeight: 700, cursor: 'pointer' }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
