import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET() {
  try {
    const rows = await imsQuery<{ key: string; value: string }>(
      'SELECT `key`, `value` FROM ims_settings'
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
