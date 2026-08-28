/**
 * GET /api/pos/settings/permissions
 * Returns POS permission settings readable by POS sessions.
 * Currently: bt_access ('disabled' | 'manager' | 'all') for branch transfers.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { resolveXeroAccountingEnabled } from '@/lib/ims/businessOperations';

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
  await getImsSession(['pos_session', 'marketoir_session']);
  const businessId: string = session.businessId ?? session.business_id ?? '';

  const rows = await imsQuery<{ key: string; value: string }>(
    "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('pos_bt_access', 'connect_accounting_software', 'accounting_software')",
    [businessId],
  ).catch(() => []);

  const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const access = settings.pos_bt_access;
  return NextResponse.json({
    bt_access: access === 'disabled' || access === 'manager' ? access : 'all',
    xeroAccountingEnabled: resolveXeroAccountingEnabled(settings),
  });
}
