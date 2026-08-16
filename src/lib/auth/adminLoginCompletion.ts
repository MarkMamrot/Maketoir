import type { UserRow } from '@/lib/db/UsersRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { primeImsDbMap } from '@/lib/db/BusinessRegistry';
import { setAdminSessionCookie, setMfaTrustCookie } from '@/lib/auth/adminAuthCookies';
import { getLoginDestinationRoute, type LoginDestination } from '@/lib/auth/loginDestination';

export function buildAdminSession(user: UserRow) {
  return {
    name: user.name ?? '',
    company: user.company ?? '',
    email: user.email,
    businessId: user.business_id ?? '',
    role: user.role ?? 'user',
    tier: user.tier ?? 'StandardUser',
    userId: user.id,
  };
}

export function completeAdminLogin(input: {
  user: UserRow;
  destination: LoginDestination;
  trustedBrowser?: { token: string; expiresAt: Date } | null;
}) {
  const session = buildAdminSession(input.user);
  setAdminSessionCookie(session);
  if (input.trustedBrowser) {
    setMfaTrustCookie(input.trustedBrowser.token, input.trustedBrowser.expiresAt);
  }
  refreshVariantCache().catch(err => console.error('Failed background cache refresh on login:', err));
  primeImsDbMap().catch(() => {});
  return { session, nextRoute: getLoginDestinationRoute(input.destination) };
}