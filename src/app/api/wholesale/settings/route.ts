/**
 * GET /api/wholesale/settings
 *
 * Returns public wholesale portal settings (browse_mode).
 * Auth: wholesale_session (used by the portal) OR marketoir_session (used by IMS admin).
 */
import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { parseWholesalePortalSettings, WHOLESALE_PORTAL_SETTING_KEYS } from '@/lib/wholesale/wholesalePortalSettings';

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
   try {
    const keys = [...Object.values(WHOLESALE_PORTAL_SETTING_KEYS), 'wholesale_browse_mode'];
    const rows = await imsQuery<{ key: string; value: string }>(
      `SELECT \`key\`, value FROM ims_settings WHERE business_id = ? AND \`key\` IN (${keys.map(() => '?').join(',')})`,
      [session.businessId, ...keys],
    );
    const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
    return NextResponse.json({
      success: true,
      data: {
        ...parseWholesalePortalSettings(settings),
        wholesale_browse_mode: settings.wholesale_browse_mode === 'product_type' ? 'product_type' : 'category',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
  });
}
