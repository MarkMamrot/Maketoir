interface RateBucket {
  windowStartedAt: number;
  count: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const buckets = new Map<string, RateBucket>();

export function checkAssistantRateLimit(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (buckets.size > 1_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.windowStartedAt >= WINDOW_MS) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt >= WINDOW_MS) {
    buckets.set(key, { windowStartedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count <= MAX_REQUESTS) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.windowStartedAt)) / 1_000)) };
}

export function clearAssistantRateLimitsForTests(): void {
  buckets.clear();
}