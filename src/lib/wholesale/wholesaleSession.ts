/**
 * Wholesale portal session helpers.
 *
 * Session cookie name: wholesale_session
 * Duration:           24 hours
 * Contents:           contactId, businessId, imsDb, email, name, company
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { signAdminSession, verifyAdminSession } from '@/lib/auth/adminSessionToken';
import { imsQuery } from '@/services/IMSMySQLService';
import { isWholesaleContactEligible, isWholesaleEnabled, parseWholesaleBrandAccess, type WholesaleBrandAccess } from './wholesaleAccess';

export interface WholesaleSession {
  contactId:  number;
  businessId: string;
  imsDb:      string;
  email:      string;
  name:       string;
  company:    string;
  supplierSlug?: string;
}

export const WHOLESALE_SESSION_COOKIE  = 'wholesale_session';
export const WHOLESALE_SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

export function getWholesaleSession(): WholesaleSession | null {
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
  | { session: WholesaleSession; brandAccess: WholesaleBrandAccess; response?: never }
  | { session?: never; brandAccess?: never; response: NextResponse }
> {
  const auth = requireWholesaleSession();
  if (auth.response) return auth;

  return runImsForBusiness(auth.session.businessId, async () => {
    const [settingRows, contactRows] = await Promise.all([
      imsQuery<{ value: string }>(
        `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'sells_wholesale' LIMIT 1`,
        [auth.session.businessId],
      ),
      imsQuery<{ type: string; price_tier: string | null; is_active: number; wholesale_allowed_brands_json: unknown }>(
        `SELECT type, price_tier, is_active, wholesale_allowed_brands_json
           FROM ims_contacts
          WHERE id = ? AND business_id = ?
          LIMIT 1`,
        [auth.session.contactId, auth.session.businessId],
      ),
    ]);

    if (!isWholesaleEnabled(settingRows[0]?.value)) {
      return { response: NextResponse.json({ error: 'Wholesale portal is not enabled for this business.', code: 'wholesale_disabled' }, { status: 403 }) };
    }
    const contact = contactRows[0];
    if (!contact || !isWholesaleContactEligible(contact.type, contact.price_tier, contact.is_active)) {
      return { response: NextResponse.json({ error: 'This contact no longer has wholesale portal access.', code: 'wholesale_contact_ineligible' }, { status: 403 }) };
    }
    return { session: auth.session, brandAccess: parseWholesaleBrandAccess(contact.wholesale_allowed_brands_json) };
  });
}
