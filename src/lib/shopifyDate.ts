/**
 * Converts any ISO 8601 timestamp (e.g. Shopify's `created_at`, which may carry
 * any timezone offset or be in UTC) to a calendar date string (YYYY-MM-DD) in
 * the BUSINESS timezone (default Australia/Sydney).
 *
 * Single source of truth for "what day did this happen" so comparisons against
 * the Shopify transition date (a plain YYYY-MM-DD entered by an Australian admin)
 * never suffer off-by-one errors around midnight.
 */
export function toBusinessDate(isoTimestamp: string | null | undefined): string {
  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  if (!isoTimestamp) {
    return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  }
  const d = new Date(isoTimestamp);
  if (isNaN(d.getTime())) return String(isoTimestamp).slice(0, 10);
  // 'sv-SE' locale formats as YYYY-MM-DD
  return d.toLocaleDateString('sv-SE', { timeZone: tz });
}
