// Simple in-memory rate limiter for POS PIN login.
//
// The app runs on a long-lived Node server (server.js on Railway), so a module-level
// Map persists across requests. This caps PIN brute-force attempts without needing
// Redis. Keyed per identifier (e.g. user_id). After MAX_FAILURES failed attempts
// within WINDOW_MS, the identifier is locked out for LOCKOUT_MS.

interface AttemptRecord {
  failures:    number;
  firstFailAt: number;
  lockedUntil: number;
}

const WINDOW_MS   = 15 * 60 * 1000; // rolling window for counting failures
const LOCKOUT_MS  = 5 * 60 * 1000;  // lockout duration once tripped
const MAX_FAILURES = 5;

const attempts = new Map<string, AttemptRecord>();

// Opportunistic cleanup so the Map can't grow unbounded.
function sweep(now: number) {
  if (attempts.size < 500) return;
  for (const [key, rec] of attempts) {
    if (rec.lockedUntil < now && now - rec.firstFailAt > WINDOW_MS) attempts.delete(key);
  }
}

/** Returns lockout info if the identifier is currently locked out. */
export function checkRateLimit(key: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** Record a failed attempt; trips the lockout once MAX_FAILURES is reached. */
export function registerFailure(key: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  let rec = attempts.get(key);
  // Reset the counter if the previous window has elapsed.
  if (!rec || now - rec.firstFailAt > WINDOW_MS) {
    rec = { failures: 0, firstFailAt: now, lockedUntil: 0 };
  }
  rec.failures++;
  if (rec.failures >= MAX_FAILURES) {
    rec.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(key, rec);
  return rec.lockedUntil > now
    ? { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) }
    : { locked: false, retryAfterSec: 0 };
}

/** Clear the record on a successful login. */
export function clearRateLimit(key: string): void {
  attempts.delete(key);
}
