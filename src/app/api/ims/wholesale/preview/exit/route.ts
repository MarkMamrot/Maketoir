import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getAdminSession } from '@/lib/sessionUtils';
import { verifyAdminSession } from '@/lib/auth/adminSessionToken';
import { imsExecute } from '@/services/IMSMySQLService';
import { type WholesaleSession, WHOLESALE_PREVIEW_SESSION_COOKIE } from '@/lib/wholesale/wholesaleSession';

export async function POST() {
  const admin = getAdminSession();
  const raw = cookies().get(WHOLESALE_PREVIEW_SESSION_COOKIE)?.value;
  const preview = raw ? verifyAdminSession<WholesaleSession>(raw) : null;
  if (admin && preview?.preview && admin.businessId === preview.businessId && admin.userId === preview.preview.actorUserId) {
    await runImsForBusiness(admin.businessId, async () => {
      await imsExecute(
        `INSERT INTO ims_wholesale_team_events
           (business_id, company_id, actor_name, target_member_id, target_contact_id, target_name, target_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'staff_preview_ended', ?)`,
        [admin.businessId, preview.companyId, `${admin.name} (${admin.email})`, preview.memberId,
          preview.contactId, preview.name || preview.email, preview.email,
          JSON.stringify({ actorUserId: admin.userId, locationId: preview.locationId, endedAt: new Date().toISOString() })],
      );
    }).catch(() => {});
  }
  cookies().set(WHOLESALE_PREVIEW_SESSION_COOKIE, '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 0, path: '/',
  });
  return NextResponse.json({ success: true, nextRoute: '/ims' });
}