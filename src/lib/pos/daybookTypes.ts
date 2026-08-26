export const DAYBOOK_PHASES = ['opening', 'during_day', 'closing'] as const;
export type DaybookPhase = typeof DAYBOOK_PHASES[number];

export const DAYBOOK_REQUEST_STATUSES = ['open', 'contacted', 'fulfilled', 'cancelled'] as const;
export type DaybookRequestStatus = typeof DAYBOOK_REQUEST_STATUSES[number];

export const DAYBOOK_NEED_STATUSES = ['requested', 'approved', 'packed', 'sent', 'received', 'cancelled'] as const;
export type DaybookNeedStatus = typeof DAYBOOK_NEED_STATUSES[number];

export const DAYBOOK_DISCREPANCY_STATUSES = ['open', 'stocktake_planned', 'adjusted', 'no_change', 'closed'] as const;
export type DaybookDiscrepancyStatus = typeof DAYBOOK_DISCREPANCY_STATUSES[number];

export interface DaybookStaffIdentity {
  id?: number | null;
  name: string;
  initials: string;
}

export interface DaybookTaskRecurrence {
  recurrence: 'daily' | 'weekly' | 'once';
  weekday?: number | null;
  scheduledDate?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface DaybookActorAudit {
  actorUserId: number | null;
  actorName: string;
  actorTier: string;
  staffIdentityId: number | null;
  staffName: string;
  staffInitials: string;
}

export const DAYBOOK_EDIT_POLICIES = ['author_only', 'managers', 'anyone'] as const;
export type DaybookEditPolicy = typeof DAYBOOK_EDIT_POLICIES[number];

export const DAYBOOK_COLOUR_KEYS = [
  'pastel_rose',
  'pastel_peach',
  'pastel_mint',
  'pastel_sky',
  'fluoro_yellow',
  'fluoro_lime',
  'fluoro_pink',
] as const;
export type DaybookColourKey = typeof DAYBOOK_COLOUR_KEYS[number];