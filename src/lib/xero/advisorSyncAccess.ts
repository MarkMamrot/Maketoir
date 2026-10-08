import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

export const ADVISOR_XERO_SYNC_SETTING = 'advisor_xero_sync_enabled';

export async function getXeroSyncAccessDenied(session: { businessId: string; tier?: string }): Promise<NextResponse | null> {
  if (session.tier !== 'Advisor') return null;
  const enabled = await runImsForBusiness(session.businessId, async () => {
    const rows = await imsQuery<{ value: string }>(
      'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
      [session.businessId, ADVISOR_XERO_SYNC_SETTING],
    );
    return ['true', '1'].includes(String(rows[0]?.value ?? '').toLowerCase());
  });
  return enabled ? null : NextResponse.json({ error: 'Advisor Xero sync access is disabled for this business.' }, { status: 403 });
}