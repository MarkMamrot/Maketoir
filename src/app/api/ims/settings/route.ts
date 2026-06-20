import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/** GET /api/ims/settings — returns all settings for the business as { key: value } */
export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId;
  try {
    const rows = await imsQuery<{ key: string; value: string }>(
      'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?',
      [businessId]
    );
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value ?? '';
    return NextResponse.json({ success: true, data: settings });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * PUT /api/ims/settings — upserts one or more key/value pairs.
 * Body: { key: string, value: string } or { settings: Record<string, string> }
 */
export async function PUT(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId;
  try {
    const body = await req.json();
    // Accept either { key, value } or { settings: { key: value, ... } }
    const pairs: Record<string, string> =
      body.settings ?? (body.key !== undefined ? { [body.key]: body.value } : body);

    for (const [key, value] of Object.entries(pairs)) {
      await imsExecute(
        'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [businessId, key, value ?? null]
      );
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
