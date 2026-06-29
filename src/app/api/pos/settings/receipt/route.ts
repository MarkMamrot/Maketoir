import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
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

    let receiptFooter    = settings['pos_receipt_footer']   || '';
    let giftReceiptMsg   = settings['gift_receipt_message'] || '';

    // If a location_id is provided, merge location-specific overrides on top
    const { searchParams } = new URL(req.url);
    const rawLocId = searchParams.get('location_id');
    if (rawLocId) {
      const locationId = parseInt(rawLocId, 10);
      if (!isNaN(locationId) && locationId > 0) {
        const locRows = await imsQuery<{ value: string }>(
          'SELECT `value` FROM ims_settings WHERE `key` = ? LIMIT 1',
          [`pos_loc_${locationId}_settings`],
        );
        if (locRows[0]?.value) {
          try {
            const loc = JSON.parse(locRows[0].value);
            if (loc.receiptFooter)      receiptFooter  = loc.receiptFooter;
            if (loc.giftReceiptMessage) giftReceiptMsg = loc.giftReceiptMessage;
          } catch {}
        }
      }
    }

    return NextResponse.json({
      business_name:        settings['business_name']    || '',
      business_address:     settings['business_address'] || '',
      business_abn:         settings['business_abn']     || '',
      pos_receipt_footer:   receiptFooter,
      gift_receipt_message: giftReceiptMsg,
    });
  } catch {
    return NextResponse.json({ business_name: '', business_address: '', business_abn: '', pos_receipt_footer: '', gift_receipt_message: '' });
  }
}
