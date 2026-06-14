/**
 * sessionUtils.ts
 * Shared helpers for parsing and validating session cookies in API routes.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminSession {
  name: string;
  company: string;
  email: string;
  userSpreadsheetId: string;
  role: string;
  userId: number;
}

export interface PosSession {
  pos_user_id: number;
  username: string;
  full_name: string;
  location_id: number;
  location_name: string;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function getAdminSession(): AdminSession | null {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as AdminSession; } catch { return null; }
}

export function getPosSession(): PosSession | null {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as PosSession; } catch { return null; }
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Require a valid admin (marketoir_session) cookie.
 * Returns { user } on success, or { response } (a 401) to return immediately.
 */
export function requireAdminSession():
  | { user: AdminSession; response?: never }
  | { user?: never; response: NextResponse } {
  const user = getAdminSession();
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }),
    };
  }
  return { user };
}

/**
 * Require that the supplied databaseId matches the logged-in user's business.
 * Prevents cross-business data access where databaseId comes from the request.
 */
export function assertBusinessAccess(
  user: AdminSession,
  databaseId: string | null | undefined,
): NextResponse | null {
  if (!databaseId) {
    return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });
  }
  if (databaseId !== user.userSpreadsheetId) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }
  return null;
}
