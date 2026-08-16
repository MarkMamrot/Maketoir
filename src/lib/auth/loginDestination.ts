import { getTierPermissions, type UserTier } from '@/lib/tierUtils';

export type LoginDestination = 'ims' | 'foresight' | 'pos';

const DESTINATION_ROUTES: Record<LoginDestination, string> = {
  ims: '/ims',
  foresight: '/dashboard',
  pos: '/pos',
};

export function parseLoginDestination(value: unknown): LoginDestination | null {
  return value === 'ims' || value === 'foresight' || value === 'pos' ? value : null;
}

export function canAccessLoginDestination(tier: UserTier, destination: LoginDestination): boolean {
  const permissions = getTierPermissions(tier);
  if (destination === 'ims') return permissions.canAccessIMS;
  if (destination === 'foresight') return permissions.canAccessDashboard;
  return permissions.canAccessPOS;
}

export function getLoginDestinationRoute(destination: LoginDestination): string {
  return DESTINATION_ROUTES[destination];
}