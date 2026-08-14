export function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const current = window.location.pathname;
  if (current === '/login' || current === '/wholesale/login') return;
  window.location.assign('/login');
}

export async function fetchWithSessionGuard(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 401 || res.status === 403) {
    redirectToLogin();
    throw new Error('Session expired');
  }
  return res;
}

export function installSessionExpiredGuard() {
  if (typeof window === 'undefined') return () => {};
  const originalFetch = globalThis.fetch.bind(globalThis);
  const guardedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    originalFetch(input, init).then(async (res) => {
      if (res.status === 401 || res.status === 403) {
        redirectToLogin();
        throw new Error('Session expired');
      }
      return res;
    });

  (globalThis as any).fetch = guardedFetch as typeof fetch;
  window.fetch = guardedFetch as typeof fetch;
  return () => {
    (globalThis as any).fetch = originalFetch;
    window.fetch = originalFetch;
  };
}
