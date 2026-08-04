export const LOYALTY_SETTING_KEYS = {
  enabled: 'loyalty_enabled',
  earnRate: 'loyalty_earn_rate',
  programName: 'loyalty_program_name',
  pointsLabel: 'loyalty_points_label',
  startedAt: 'loyalty_started_at',
} as const;

export const DEFAULT_LOYALTY_SETTINGS = {
  enabled: false,
  earnRate: 1,
  programName: 'Rewards Program',
  pointsLabel: 'Points',
  startedAt: null,
} as const;

export type LoyaltyTransactionType =
  | 'earn'
  | 'redeem'
  | 'earn_reversal'
  | 'redeem_reversal'
  | 'adjustment'
  | 'migration';

export type LoyaltyChannel = 'pos' | 'shopify' | 'manual' | 'migration';
export type LoyaltyAccountStatus = 'active' | 'suspended' | 'closed';
export type LoyaltyRedemptionStatus = 'reserved' | 'issued' | 'used' | 'cancelled' | 'expired';

export interface LoyaltySettings {
  enabled: boolean;
  earnRate: number;
  programName: string;
  pointsLabel: string;
  startedAt: string | null;
}

export interface LoyaltyEarnInput {
  merchandiseTotal: number;
  discountTotal?: number;
  giftCardProductTotal?: number;
  loyaltyDiscountTotal?: number;
  earnRate: number;
}

export interface LoyaltyReward {
  id: number;
  businessId: string;
  rewardCode: string;
  displayName: string;
  description: string | null;
  pointsCost: number;
  valueAud: number;
  isActive: boolean;
  sortOrder: number;
}

export interface LoyaltyAccount {
  id: number;
  businessId: string;
  contactId: number;
  balancePoints: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  status: LoyaltyAccountStatus;
}

export interface LoyaltyMutationResult {
  transactionId: number;
  accountId: number;
  balanceAfter: number;
  duplicate: boolean;
}

export interface LoyaltyRedemptionResult extends LoyaltyMutationResult {
  redemptionId: number;
  rewardId: number;
  pointsDeducted: number;
  status: LoyaltyRedemptionStatus;
}
