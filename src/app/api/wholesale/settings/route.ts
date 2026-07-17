/**
 * GET /api/wholesale/settings
 *
 * Returns public wholesale portal settings (browse_mode).
 * Auth: wholesale_session (used by the portal) OR marketoir_session (used by IMS admin).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';

async function getSession() {
  const c = cookies();
  // Prefer admin session (for IMS settings panel)
  const admin = c.get('marketoir_session');
  if (admin?.value) {
    try { return { ...JSON.parse(admin.value), _type: 'admin' }; } catch { /* */ }
  }
  const ws = c.get('wholesale_session');
  if (ws?.value) {
    try { return { ...JSON.parse(ws.value), _type: 'wholesale' }; } catch { /* */ }
  }
  return null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  await enterImsForBusiness(session.businessId);
  try {
    const rows = await imsQuery<{ key: string; value: string }>(
      `SELECT \`key\`, value FROM ims_settings WHERE business_id = ? AND \`key\` LIKE 'wholesale_%'`,
      [session.businessId],
    );
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return NextResponse.json({ success: true, data: settings });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
