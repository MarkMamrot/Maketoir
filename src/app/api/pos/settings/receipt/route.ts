import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  try {
    const session = getSession();
    const businessId = session?.businessId as string | undefined;
    const rows = await imsQuery<{ key: string; value: string }>(
      businessId
        ? 'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?'
        : 'SELECT `key`, `value` FROM ims_settings WHERE business_id IS NULL OR business_id = \'\'',
      businessId ? [businessId] : undefined
    );
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value ?? '';
    }
    return NextResponse.json({
      business_name: settings['business_name'] || '',
      business_address: settings['business_address'] || '',
      business_abn: settings['business_abn'] || '',
      pos_receipt_footer: settings['pos_receipt_footer'] || ''
    });
  } catch (err: any) {
    return NextResponse.json({ business_name: '', business_address: '', business_abn: '', pos_receipt_footer: '' });
  }
}
