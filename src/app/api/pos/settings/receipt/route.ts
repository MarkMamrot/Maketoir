import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET(req: Request) {
  try {
    const adminSession = getAdminSession();
    const posSession   = getPosSession();
    const businessId = (adminSession?.businessId ?? posSession?.businessId) as string | undefined;
    if (!businessId) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    await getImsSession(['marketoir_session', 'pos_session']);
    const rows = await imsQuery<{ key: string; value: string }>(
      'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?',
      [businessId]
    );
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value ?? '';
    }

    let receiptFooter    = settings['pos_receipt_footer']   || '';
    let giftReceiptMsg   = settings['gift_receipt_message'] || '';
    // Default address/phone from global settings; overridden by branch address below
    let businessAddress  = settings['business_address'] || '';
    let businessPhone    = settings['business_phone']   || '';

    // If a location_id is provided, pull the branch address from ims_locations
    // and merge any per-location receipt overrides from ims_settings
    const { searchParams } = new URL(req.url);
    const rawLocId = searchParams.get('location_id');
    if (rawLocId) {
      const locationId = parseInt(rawLocId, 10);
      if (!isNaN(locationId) && locationId > 0) {
        // Fetch branch details
        const locDetailRows = await imsQuery<{ address: string | null; city: string | null; state: string | null; postcode: string | null; phone: string | null }>(
          'SELECT address, city, state, postcode, phone FROM ims_locations WHERE id = ? AND business_id = ? LIMIT 1',
          [locationId, businessId],
        );
        if (locDetailRows[0]) {
          const loc = locDetailRows[0];
          const parts = [loc.address, [loc.city, loc.state].filter(Boolean).join(' '), loc.postcode].filter(Boolean);
          if (parts.length) businessAddress = parts.join(', ');
          if (loc.phone) businessPhone = loc.phone;
        }

        // Merge per-location receipt text overrides
        const locRows = await imsQuery<{ value: string }>(
          'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
          [businessId, `pos_loc_${locationId}_settings`],
        );
        if (locRows[0]?.value) {
          try {
            const locOverride = JSON.parse(locRows[0].value);
            if (locOverride.receiptFooter)      receiptFooter  = locOverride.receiptFooter;
            if (locOverride.giftReceiptMessage) giftReceiptMsg = locOverride.giftReceiptMessage;
          } catch {}
        }
      }
    }

    return NextResponse.json({
      business_name:        settings['business_name'] || '',
      business_address:     businessAddress,
      business_phone:       businessPhone,
      business_abn:         settings['business_abn'] || '',
      pos_receipt_footer:   receiptFooter,
      gift_receipt_message: giftReceiptMsg,
      receipt_logo_url:     settings['pos_receipt_logo'] || '',
    });
  } catch {
    return NextResponse.json({ business_name: '', business_address: '', business_phone: '', business_abn: '', pos_receipt_footer: '', gift_receipt_message: '', receipt_logo_url: '' });
  }
}
