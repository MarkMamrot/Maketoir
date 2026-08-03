export const DEFAULT_INVALID_URL_EXCLUSION_DAYS = 5;
export const MAX_INVALID_URL_EXCLUSION_DAYS = 90;

export function normalizeInvalidUrlExclusionDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INVALID_URL_EXCLUSION_DAYS;
  return Math.min(MAX_INVALID_URL_EXCLUSION_DAYS, Math.max(0, Math.trunc(parsed)));
}

export function isRecentInvalidUrlAttempt(
  attemptedAt: string | null | undefined,
  exclusionDays: number,
  nowMs = Date.now(),
): boolean {
  if (!attemptedAt || exclusionDays <= 0) return false;
  const attemptedMs = new Date(attemptedAt).getTime();
  if (!Number.isFinite(attemptedMs)) return false;
  const ageMs = nowMs - attemptedMs;
  return ageMs >= 0 && ageMs < exclusionDays * 24 * 60 * 60 * 1000;
}