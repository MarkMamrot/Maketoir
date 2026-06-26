/**
 * Tier-based access control utilities for frontend
 */

export type UserTier = 'SuperAdmin' | 'Admin' | 'StandardUser' | 'PosManager' | 'PosUser';

export interface TierPermissions {
  canAccessSettings: boolean;
  canAccessSetup: boolean;
  canAccessIMS: boolean;
  canAccessPOS: boolean;
  canAccessDashboard: boolean;
  canAccessConnections: boolean;
  canManageUsers: boolean;
  canAccessAnalytics: boolean;
}

/**
 * Get permissions for a given tier
 */
export function getTierPermissions(tier: UserTier | undefined): TierPermissions {
  const tier_ = tier ?? 'StandardUser';

  const permissions: Record<UserTier, TierPermissions> = {
    SuperAdmin: {
      canAccessSettings: true,
      canAccessSetup: true,
      canAccessIMS: true,
      canAccessPOS: true,
      canAccessDashboard: true,
      canAccessConnections: true,
      canManageUsers: true,
      canAccessAnalytics: true,
    },
    Admin: {
      canAccessSettings: true,
      canAccessSetup: true,
      canAccessIMS: true,
      canAccessPOS: true,
      canAccessDashboard: true,
      canAccessConnections: true,
      canManageUsers: true,
      canAccessAnalytics: true,
    },
    StandardUser: {
      canAccessSettings: false,
      canAccessSetup: false,
      canAccessIMS: true,
      canAccessPOS: true,
      canAccessDashboard: true,
      canAccessConnections: true,
      canManageUsers: false,
      canAccessAnalytics: true,
    },
    PosManager: {
      canAccessSettings: false,
      canAccessSetup: false,
      canAccessIMS: false,
      canAccessPOS: true,
      canAccessDashboard: false,
      canAccessConnections: false,
      canManageUsers: false,
      canAccessAnalytics: false,
    },
    PosUser: {
      canAccessSettings: false,
      canAccessSetup: false,
      canAccessIMS: false,
      canAccessPOS: true,
      canAccessDashboard: false,
      canAccessConnections: false,
      canManageUsers: false,
      canAccessAnalytics: false,
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
    'SuperAdmin': 5,
    'Admin': 4,
    'StandardUser': 3,
    'PosManager': 2,
    'PosUser': 1,
  };

  return tierHierarchy[userTier] >= tierHierarchy[requiredTier];
}

/**
 * Get tier label for display
 */
export function getTierLabel(tier: UserTier | undefined): string {
  const labels: Record<UserTier, string> = {
    SuperAdmin: 'Super Admin',
    Admin: 'Admin',
    StandardUser: 'Standard User',
    PosManager: 'POS Manager',
    PosUser: 'POS User',
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
  };

  return descriptions[tier ?? 'StandardUser'];
}
