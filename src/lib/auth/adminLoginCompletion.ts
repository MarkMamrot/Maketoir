import type { UserRow } from '@/lib/db/UsersRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { primeImsDbMap } from '@/lib/db/BusinessRegistry';
import { setAdminSessionCookie, setMfaTrustCookie } from '@/lib/auth/adminAuthCookies';
import { getLoginDestinationRoute, type LoginDestination } from '@/lib/auth/loginDestination';
import type { BusinessMembership } from '@/lib/auth/businessMemberships';
import { recordActiveBusiness } from '@/lib/auth/businessMemberships';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export function buildAdminSession(user: UserRow, membership: BusinessMembership) {
  return {
    name: user.name ?? '',
    company: membership.businessName,
    email: user.email,
    businessId: membership.businessId,
    role: user.role ?? 'user',
    tier: user.tier === 'SuperAdmin' ? 'SuperAdmin' : membership.tier,
    userId: user.id,
  };
}

export function completeAdminLogin(input: {
  user: UserRow;
  membership: BusinessMembership;
  destination: LoginDestination;
  trustedBrowser?: { token: string; expiresAt: Date } | null;
}) {
  const session = buildAdminSession(input.user, input.membership);
  setAdminSessionCookie(session);
  if (input.user.tier !== 'SuperAdmin') {
    void recordActiveBusiness(input.user.id, input.membership.businessId).catch(error => reportRuntimeIssue({
      businessId: input.membership.businessId,
      source: 'auth.login',
      operation: 'record_active_business',
      title: 'Last active business could not be recorded',
      error,
      context: { userId: input.user.id },
    }));
  }
  if (input.trustedBrowser) {
    setMfaTrustCookie(input.trustedBrowser.token, input.trustedBrowser.expiresAt);
  }
  refreshVariantCache().catch(err => console.error('Failed background cache refresh on login:', err));
  primeImsDbMap().catch(() => {});
  return { session, nextRoute: getLoginDestinationRoute(input.destination) };
}