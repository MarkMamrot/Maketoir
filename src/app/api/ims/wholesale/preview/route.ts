import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getImsDbNameStrict, runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';
import { getActiveWholesaleBuyer } from '@/lib/wholesale/wholesaleIdentity';
import {
  signWholesalePreviewSession,
  WHOLESALE_PREVIEW_SESSION_COOKIE,
  WHOLESALE_PREVIEW_SESSION_MAX_AGE,
} from '@/lib/wholesale/wholesaleSession';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { randomUUID } from 'crypto';
import { parseWholesalePortalSettings, WHOLESALE_PORTAL_SETTING_KEYS } from '@/lib/wholesale/wholesalePortalSettings';

async function getPreviewMode(businessId: string) {
  const rows = await imsQuery<{ value: string }>(
    'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [businessId, WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode],
  );
  return parseWholesalePortalSettings({ [WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode]: rows[0]?.value }).staffPreviewMode;
}

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;

  try {
    const profile = await WholesaleSupplierProfileRepository.getByBusinessId(auth.user.businessId);
    if (!profile?.isActive) return NextResponse.json({ error: 'Wholesale portal is not enabled for this organisation.' }, { status: 409 });
    return runImsForBusiness(auth.user.businessId, async () => {
      const mode = await getPreviewMode(auth.user.businessId);
      const rows = await imsQuery<any>(
        `SELECT wm.id AS member_id, wm.contact_id, wm.role, wc.id AS company_id, wc.company_name,
                wl.id AS location_id, wl.location_name, wl.is_primary, c.name, c.email
           FROM ims_wholesale_company_members wm
           JOIN ims_contacts c ON c.id = wm.contact_id AND c.business_id = wm.business_id
            AND c.is_active = 1 AND c.type IN ('b2b_customer','both')
            AND LOWER(COALESCE(c.price_tier,'')) = 'wholesale'
           JOIN ims_wholesale_companies wc ON wc.id = wm.company_id AND wc.business_id = wm.business_id AND wc.status = 'active'
           JOIN ims_wholesale_member_locations ml ON ml.member_id = wm.id AND ml.business_id = wm.business_id AND ml.company_id = wm.company_id
           JOIN ims_wholesale_company_locations wl ON wl.id = ml.location_id AND wl.business_id = ml.business_id
            AND wl.company_id = ml.company_id AND wl.status = 'active'
          WHERE wm.business_id = ? AND wm.is_active = 1
          ORDER BY wc.company_name, c.name, wl.is_primary DESC, wl.location_name, wm.id`,
        [auth.user.businessId],
      );
      return NextResponse.json({
        success: true,
        supplier: { slug: profile.slug, name: profile.displayName },
        mode,
        targets: rows.map(row => ({
          memberId: Number(row.member_id), contactId: Number(row.contact_id), role: row.role,
          companyId: Number(row.company_id), companyName: row.company_name,
          locationId: Number(row.location_id), locationName: row.location_name,
          isPrimary: Boolean(row.is_primary), buyerName: row.name || row.email, email: row.email,
        })),
      });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'wholesale_preview', operation: 'list_targets', title: 'Wholesale preview targets could not be loaded', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Wholesale preview could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  let memberId: number;
  let locationId: number;
  try {
    const body = await request.json();
    memberId = Number(body.memberId); locationId = Number(body.locationId);
    if (![memberId, locationId].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error();
  } catch {
    return NextResponse.json({ error: 'Select a valid wholesale buyer and location.' }, { status: 400 });
  }

  try {
    const [profile, imsDb] = await Promise.all([
      WholesaleSupplierProfileRepository.getByBusinessId(auth.user.businessId),
      getImsDbNameStrict(auth.user.businessId),
    ]);
    if (!profile?.isActive || !imsDb) return NextResponse.json({ error: 'Wholesale portal is not enabled for this organisation.' }, { status: 409 });

    return runImsForBusiness(auth.user.businessId, async () => {
      const mode = await getPreviewMode(auth.user.businessId);
      const targets = await imsQuery<{ contact_id: number }>(
        `SELECT wm.contact_id FROM ims_wholesale_company_members wm
          JOIN ims_wholesale_member_locations ml ON ml.member_id = wm.id AND ml.business_id = wm.business_id AND ml.company_id = wm.company_id
          JOIN ims_wholesale_company_locations wl ON wl.id = ml.location_id AND wl.business_id = ml.business_id AND wl.company_id = ml.company_id AND wl.status = 'active'
          WHERE wm.id = ? AND wm.business_id = ? AND wm.is_active = 1 AND ml.location_id = ? LIMIT 1`,
        [memberId, auth.user.businessId, locationId],
      );
      const contactId = Number(targets[0]?.contact_id || 0);
      const buyer = contactId ? await getActiveWholesaleBuyer(auth.user.businessId, contactId, locationId) : null;
      if (!buyer || buyer.memberId !== memberId) return NextResponse.json({ error: 'That wholesale buyer or location is no longer available.' }, { status: 409 });

      const startedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + WHOLESALE_PREVIEW_SESSION_MAX_AGE * 1000).toISOString();
      const previewSessionId = randomUUID();
      cookies().set(WHOLESALE_PREVIEW_SESSION_COOKIE, signWholesalePreviewSession({
        contactId: buyer.contactId, businessId: buyer.businessId, imsDb, email: buyer.email,
        name: buyer.name, company: buyer.company, supplierSlug: profile.slug,
        companyId: buyer.companyId, locationId: buyer.locationId, memberId: buyer.memberId,
        memberRole: buyer.memberRole,
        preview: { actorUserId: auth.user.userId, actorName: auth.user.name, actorEmail: auth.user.email, startedAt, expiresAt, previewSessionId, mode },
      }), {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
        maxAge: WHOLESALE_PREVIEW_SESSION_MAX_AGE, path: '/',
      });
      await imsExecute(
        `INSERT INTO ims_wholesale_team_events
           (business_id, company_id, actor_name, target_member_id, target_contact_id, target_name, target_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'staff_preview_started', ?)`,
        [auth.user.businessId, buyer.companyId, `${auth.user.name} (${auth.user.email})`, buyer.memberId,
          buyer.contactId, buyer.name || buyer.email, buyer.email,
          JSON.stringify({ actorUserId: auth.user.userId, locationId: buyer.locationId, startedAt, expiresAt, previewSessionId, mode })],
      );
      return NextResponse.json({ success: true, nextRoute: `/wholesale/${profile.slug}/catalogue` });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'wholesale_preview', operation: 'start', title: 'Wholesale staff preview could not be started', error, reference: { type: 'wholesale_member', id: memberId } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Wholesale preview could not be started.' }, { status: 500 });
  }
}