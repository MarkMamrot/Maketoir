/**
 * Wholesale portal session helpers.
 *
 * Session cookie name: wholesale_session
 * Duration:           24 hours
 * Contents:           contactId, businessId, imsDb, email, name, company
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export interface WholesaleSession {
  contactId:  number;
  businessId: string;
  imsDb:      string;
  email:      string;
  name:       string;
  company:    string;
}

export const WHOLESALE_SESSION_COOKIE  = 'wholesale_session';
export const WHOLESALE_SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

export function getWholesaleSession(): WholesaleSession | null {
  const raw = cookies().get(WHOLESALE_SESSION_COOKIE)?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as WholesaleSession; } catch { return null; }
}

/** For use in API routes — returns the session or a 401 NextResponse. */
export function requireWholesaleSession():
  | { session: WholesaleSession; response?: never }
  | { session?: never; response: NextResponse } {
  const session = getWholesaleSession();
  if (!session) {
    return { response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) };
  }
  return { session };
}
