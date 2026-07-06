/**
 * Tier-based access control utilities for frontend
 */

export type UserTier = 'SuperAdmin' | 'Admin' | 'StandardUser' | 'PosManager' | 'PosUser' | 'Advisor';

export interface TierPermissions {
  canAccessSettings: boolean;
  canAccessSetup: boolean;
  canAccessIMS: boolean;
  canAccessPOS: boolean;
  canAccessDashboard: boolean;
  canAccessConnections: boolean;
  canManageUsers: boolean;
  canAccessAnalytics: boolean;
  isReadOnly: boolean;
}

/**
 * Get permissions for a given tier
 */
export function getTierPermissions(tier: UserTier | undefined): TierPermissions {
  const tier_ = tier ?? 'StandardUser';

  const permissions: Record<UserTier, TierPermissions> = {
    SuperAdmin: {
      canAccessSettings: true, canAccessSetup: true, canAccessIMS: true, canAccessPOS: true,
      canAccessDashboard: true, canAccessConnections: true, canManageUsers: true, canAccessAnalytics: true, isReadOnly: false,
    },
    Admin: {
      canAccessSettings: true, canAccessSetup: true, canAccessIMS: true, canAccessPOS: true,
      canAccessDashboard: true, canAccessConnections: true, canManageUsers: true, canAccessAnalytics: true, isReadOnly: false,
    },
    StandardUser: {
      canAccessSettings: false, canAccessSetup: false, canAccessIMS: true, canAccessPOS: true,
      canAccessDashboard: true, canAccessConnections: true, canManageUsers: false, canAccessAnalytics: true, isReadOnly: false,
    },
    PosManager: {
      canAccessSettings: false, canAccessSetup: false, canAccessIMS: false, canAccessPOS: true,
      canAccessDashboard: false, canAccessConnections: false, canManageUsers: false, canAccessAnalytics: false, isReadOnly: false,
    },
    PosUser: {
      canAccessSettings: false, canAccessSetup: false, canAccessIMS: false, canAccessPOS: true,
      canAccessDashboard: false, canAccessConnections: false, canManageUsers: false, canAccessAnalytics: false, isReadOnly: false,
    },
    Advisor: {
      canAccessSettings: false, canAccessSetup: false, canAccessIMS: true, canAccessPOS: false,
      canAccessDashboard: false, canAccessConnections: false, canManageUsers: false, canAccessAnalytics: false, isReadOnly: true,
    },
  };

  return permissions[tier_];
}

/**
 * Check if tier has required tier access (hierarchical)
 */
export function hasTierAccess(userTier: UserTier | undefined, requiredTier: UserTier): boolean {
  if (!userTier) return false;

  const tierHierarchy: Record<UserTier, number> = {
    'SuperAdmin': 5, 'Admin': 4, 'StandardUser': 3, 'PosManager': 2, 'PosUser': 1, 'Advisor': 0,
  };

  return tierHierarchy[userTier] >= tierHierarchy[requiredTier];
}

/**
 * Get tier label for display
 */
export function getTierLabel(tier: UserTier | undefined): string {
  const labels: Record<UserTier, string> = {
    SuperAdmin: 'Super Admin', Admin: 'Admin', StandardUser: 'Standard User',
    PosManager: 'POS Manager', PosUser: 'POS User', Advisor: 'Advisor',
  };

  return labels[tier ?? 'StandardUser'];
}

/**
 * Get tier description
 */
export function getTierDescription(tier: UserTier | undefined): string {
  const descriptions: Record<UserTier, string> = {
    SuperAdmin: 'Full system access including user management',
    Admin: 'Organisation-wide full access including settings',
    StandardUser: 'Access everything except settings',
    PosManager: 'POS access with ability to change POS settings and appearance',
    PosUser: 'POS system access only',
    Advisor: 'Read-only IMS access — no create, edit, or delete. Sync access configurable.',
  };
  return descriptions[tier ?? 'StandardUser'];
}
