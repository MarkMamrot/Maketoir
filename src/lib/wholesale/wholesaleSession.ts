/**
 * Wholesale portal session helpers.
 *
 * Session cookie name: wholesale_session
 * Duration:           24 hours
 * Contents:           contactId, businessId, imsDb, email, name, company
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { signAdminSession, verifyAdminSession } from '@/lib/auth/adminSessionToken';
import type { WholesaleBrandAccess } from './wholesaleAccess';
import { getActiveWholesaleBuyer } from './wholesaleIdentity';
import { getAdminSession } from '@/lib/sessionUtils';

export interface WholesalePreviewMetadata {
  actorUserId: number;
  actorName: string;
  actorEmail: string;
  startedAt: string;
}

export interface WholesaleSession {
  contactId:  number;
  businessId: string;
  imsDb:      string;
  email:      string;
  name:       string;
  company:    string;
  supplierSlug?: string;
  companyId?: number;
  locationId?: number;
  memberId?: number;
  memberRole?: 'owner' | 'admin' | 'buyer';
  preview?: WholesalePreviewMetadata;
}

export type ActiveWholesaleSession = WholesaleSession & Required<Pick<
  WholesaleSession,
  'companyId' | 'locationId' | 'memberId' | 'memberRole'
>>;

export const WHOLESALE_SESSION_COOKIE  = 'wholesale_session';
export const WHOLESALE_PREVIEW_SESSION_COOKIE = 'wholesale_preview_session';
export const WHOLESALE_SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours
export const WHOLESALE_PREVIEW_SESSION_MAX_AGE = 60 * 5;

export function getWholesaleSession(): WholesaleSession | null {
  const previewRaw = cookies().get(WHOLESALE_PREVIEW_SESSION_COOKIE)?.value;
  if (previewRaw) {
    const preview = verifyAdminSession<WholesaleSession>(previewRaw);
    const admin = getAdminSession();
    if (
      preview?.preview && admin &&
      (admin.tier === 'Admin' || admin.tier === 'SuperAdmin') &&
      admin.businessId === preview.businessId && admin.userId === preview.preview.actorUserId
    ) return preview;
    return null;
  }

  const raw = cookies().get(WHOLESALE_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const signed = verifyAdminSession<WholesaleSession>(raw);
  if (signed) return signed;

  // Temporary migration compatibility for sessions issued before passwordless auth.
  try {
    const legacy = JSON.parse(raw) as WholesaleSession;
    return legacy?.contactId && legacy?.businessId ? legacy : null;
  } catch {
    return null;
  }
}

export function signWholesaleSession(session: WholesaleSession): string {
  return signAdminSession(session, { maxAgeSeconds: WHOLESALE_SESSION_MAX_AGE });
}

export function signWholesalePreviewSession(session: WholesaleSession): string {
  return signAdminSession(session, { maxAgeSeconds: WHOLESALE_PREVIEW_SESSION_MAX_AGE });
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

export async function requireActiveWholesaleSession(): Promise<
  | { session: ActiveWholesaleSession; brandAccess: WholesaleBrandAccess; response?: never }
  | { session?: never; brandAccess?: never; response: NextResponse }
> {
  const auth = requireWholesaleSession();
  if (auth.response) return auth;

  const buyer = await getActiveWholesaleBuyer(auth.session.businessId, auth.session.contactId, auth.session.locationId);
  if (!buyer) {
    return { response: NextResponse.json({ error: 'This account no longer has wholesale portal access.', code: 'wholesale_account_ineligible' }, { status: 403 }) };
  }
  return {
    session: {
      ...auth.session,
      email: buyer.email,
      name: buyer.name,
      company: buyer.company,
      companyId: buyer.companyId,
      locationId: buyer.locationId,
      memberId: buyer.memberId,
      memberRole: buyer.memberRole,
    } as ActiveWholesaleSession,
    brandAccess: buyer.brandAccess,
  };
}
