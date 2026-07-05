/**
 * GET /api/pos/settings/permissions
 * Returns POS permission settings readable by POS sessions.
 * Currently: bt_access ('disabled' | 'manager' | 'all') for branch transfers.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  for (const name of ['pos_session', 'marketoir_session']) {
    const raw = cookies().get(name)?.value;
    if (!raw) continue;
    try { return JSON.parse(raw); } catch {}
  }
  return null;
}

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const businessId: string = session.businessId ?? session.business_id ?? '';

  const rows = await imsQuery<{ value: string }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'pos_bt_access' LIMIT 1",
    [businessId],
  ).catch(() => []);

  return NextResponse.json({ bt_access: rows[0]?.value ?? 'manager' });
}
