export const ONLINE_SYNC_LIMITS = {
  intervalMs: 15 * 60_000,
  overlapMs: 5 * 60_000,
  visibilityLagMs: 2 * 60_000,
  pageSize: 250,
  ordersPerChannel: 25,
  ordersPerInvocation: 100,
  jobsPerBusiness: 25,
  invocationMs: 45_000,
  leaseSeconds: 180,
  retryBaseSeconds: 60,
  retryMaxSeconds: 3600,
  escalationAttempts: 8,
} as const;

export type OnlineSyncRollout = 'legacy' | 'validation' | 'cutover';
export type ReconciliationPhase = 'baseline' | 'catchup' | 'incremental' | 'anti_entropy';
export interface ReconciliationWindow {
  phase: ReconciliationPhase;
  from: string;
  to: string;
}
export interface OrderReference {
  id: string;
  updatedAt: string;
}
export interface ReconciliationContinuation {
  window: ReconciliationWindow;
  pageInfo: string | null;
  remaining: OrderReference[];
  nextPageInfo: string | null;
  pageLoaded: boolean;
}

export class OnlineSyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnlineSyncValidationError';
  }
}

export class OnlineSyncLeaseLostError extends Error {
  constructor() {
    super('Online sync lease is no longer owned by this worker.');
    this.name = 'OnlineSyncLeaseLostError';
  }
}

export function onlineSyncTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new OnlineSyncValidationError('An ISO timestamp with an explicit timezone is required.');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new OnlineSyncValidationError('Invalid online sync timestamp.');
  const normalized = new Date(milliseconds).toISOString();
  const localDate = value.slice(0, 10);
  const [year, month, day] = localDate.split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.toISOString().slice(0, 10) !== localDate || !normalized) {
    throw new OnlineSyncValidationError('Invalid online sync calendar date.');
  }
  return milliseconds;
}

export function validateReconciliationWindow(window: ReconciliationWindow): ReconciliationWindow {
  if (!['baseline', 'catchup', 'incremental', 'anti_entropy'].includes(window.phase)) {
    throw new OnlineSyncValidationError('Invalid reconciliation phase.');
  }
  const from = onlineSyncTimestamp(window.from);
  const to = onlineSyncTimestamp(window.to);
  if (from >= to) throw new OnlineSyncValidationError('Reconciliation start must precede its end.');
  return { phase: window.phase, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function nextReconciliationWindow(input: {
  baselineFrom: string;
  coveredThrough: string | null;
  now: string;
}): ReconciliationWindow | null {
  const start = onlineSyncTimestamp(input.baselineFrom);
  const end = onlineSyncTimestamp(input.now) - ONLINE_SYNC_LIMITS.visibilityLagMs;
  const covered = input.coveredThrough === null ? null : onlineSyncTimestamp(input.coveredThrough);
  if (covered !== null && covered < start) {
    throw new OnlineSyncValidationError('Reconciliation coverage precedes its baseline.');
  }
  if (end <= start || (covered !== null && end <= covered)) return null;
  return {
    phase: covered === null ? 'baseline' : 'incremental',
    from: new Date(covered === null ? start : Math.max(start, covered - ONLINE_SYNC_LIMITS.overlapMs)).toISOString(),
    to: new Date(end).toISOString(),
  };
}

export function parseReconciliationContinuation(value: unknown): ReconciliationContinuation {
  const record = object(value, 'Invalid reconciliation continuation.');
  const rawWindow = object(record.window, 'Missing reconciliation window.');
  if (typeof rawWindow.phase !== 'string' || typeof rawWindow.from !== 'string' || typeof rawWindow.to !== 'string') {
    throw new OnlineSyncValidationError('Invalid reconciliation window fields.');
  }
  const phase = rawWindow.phase;
  if (phase !== 'baseline' && phase !== 'catchup' && phase !== 'incremental' && phase !== 'anti_entropy') {
    throw new OnlineSyncValidationError('Invalid reconciliation phase.');
  }
  const window = validateReconciliationWindow({ phase, from: rawWindow.from, to: rawWindow.to });
  if (typeof record.pageLoaded !== 'boolean' || !Array.isArray(record.remaining)
    || record.remaining.length > ONLINE_SYNC_LIMITS.pageSize) {
    throw new OnlineSyncValidationError('Invalid reconciliation page state.');
  }
  const remaining = record.remaining.map(item => {
    const reference = object(item, 'Invalid reconciliation order reference.');
    if (typeof reference.id !== 'string' || !/^[1-9]\d*$/.test(reference.id)
      || typeof reference.updatedAt !== 'string') {
      throw new OnlineSyncValidationError('Invalid reconciliation order identity.');
    }
    const updatedAt = new Date(onlineSyncTimestamp(reference.updatedAt)).toISOString();
    return { id: reference.id, updatedAt };
  });
  if (new Set(remaining.map(item => item.id)).size !== remaining.length) {
    throw new OnlineSyncValidationError('Duplicate orders in reconciliation page.');
  }
  if (!record.pageLoaded && remaining.length) {
    throw new OnlineSyncValidationError('Unloaded reconciliation page has pending orders.');
  }
  return {
    window,
    pageInfo: onlineSyncPageInfo(record.pageInfo),
    remaining,
    nextPageInfo: onlineSyncPageInfo(record.nextPageInfo),
    pageLoaded: record.pageLoaded,
  };
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OnlineSyncValidationError(message);
  return value as Record<string, unknown>;
}

export function onlineSyncPageInfo(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+=/-]{1,8192}$/.test(value)) {
    throw new OnlineSyncValidationError('Invalid Shopify pagination token.');
  }
  return value;
}

export function onlineSyncOffsetMs(businessId: string, channelInstanceId: string): number {
  if (!businessId.trim() || !channelInstanceId.trim()) throw new OnlineSyncValidationError('Exact sync owner is required.');
  let hash = 2166136261;
  for (const character of `${businessId}\0${channelInstanceId}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return hash % ONLINE_SYNC_LIMITS.intervalMs;
}

export function nextOnlineSyncDue(now: string, businessId: string, channelInstanceId: string): string {
  const milliseconds = onlineSyncTimestamp(now);
  const offset = onlineSyncOffsetMs(businessId, channelInstanceId);
  const slot = Math.floor((milliseconds - offset) / ONLINE_SYNC_LIMITS.intervalMs) + 1;
  return new Date(slot * ONLINE_SYNC_LIMITS.intervalMs + offset).toISOString();
}

export function onlineSyncRetrySeconds(attempt: number, jitter: number, retryAfterSeconds = 0): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || !Number.isFinite(jitter) || jitter < 0 || jitter > 1
    || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    throw new OnlineSyncValidationError('Invalid online sync retry parameters.');
  }
  const base = Math.min(ONLINE_SYNC_LIMITS.retryMaxSeconds, ONLINE_SYNC_LIMITS.retryBaseSeconds * 2 ** Math.min(20, attempt - 1));
  return Math.max(Math.ceil(retryAfterSeconds), Math.min(ONLINE_SYNC_LIMITS.retryMaxSeconds, Math.ceil(base * (1 + jitter * 0.2))));
}

export type OnlinePostingReadiness =
  | { ready: true }
  | { ready: false; reason: 'paused' | 'baseline_incomplete' | 'reconciliation_incomplete' | 'order_review_required' | 'posted_day_changed' };

export function onlinePostingReadiness(input: {
  provider: 'shopify' | 'native_shop';
  paused: boolean;
  baselineComplete: boolean;
  coveredThrough: string | null;
  requiredThrough: string;
  unresolvedOrderEffects: boolean;
  postedDayChanged: boolean;
}): OnlinePostingReadiness {
  if (input.paused) return { ready: false, reason: 'paused' };
  if (input.postedDayChanged) return { ready: false, reason: 'posted_day_changed' };
  if (input.unresolvedOrderEffects) return { ready: false, reason: 'order_review_required' };
  if (input.provider === 'native_shop') return { ready: true };
  if (!input.baselineComplete) return { ready: false, reason: 'baseline_incomplete' };
  const required = onlineSyncTimestamp(input.requiredThrough);
  if (input.coveredThrough === null || onlineSyncTimestamp(input.coveredThrough) < required) {
    return { ready: false, reason: 'reconciliation_incomplete' };
  }
  return { ready: true };
}
