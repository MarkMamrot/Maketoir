'use client';
export function AccountLogoutButton({ storeSlug }: { storeSlug: string }) {
  return <button onClick={async () => { const response = await fetch(`/api/shop/${storeSlug}/auth/logout`, { method: 'POST' }); const body = await response.json(); window.location.assign(body.nextRoute); }}>Sign out</button>;
}