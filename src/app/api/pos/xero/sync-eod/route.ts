/**
 * POST /api/pos/xero/sync-eod
 * Body: { locationId: number, date: string }
 *
 * Manual trigger / retry for EOD → Xero sync.
 * The same logic runs automatically on POST /api/pos/eod (register close).
 * Requires marketoir_session for businessId.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosEodRepo } from '@/lib/db/PosRepository';
import { triggerEodXeroSync } from '@/services/XeroSyncService';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';

export async function POST(req: Request) {
  // Accept either marketoir_session (admin) or pos_session (POS staff).
  // businessId is taken from the admin session or looked up from ims_locations.
  const adminRaw = cookies().get('marketoir_session')?.value;
  const adminSession = adminRaw ? (() => { try { return JSON.parse(adminRaw); } catch { return null; } })() : null;
  const posRaw = cookies().get('pos_session')?.value;
  const posSession = posRaw ? (() => { try { return JSON.parse(posRaw); } catch { return null; } })() : null;
  if (!adminSession && !posSession) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  const boundSession = await getImsSession(['marketoir_session', 'pos_session']);

  const { locationId, date, registerId } = await req.json();
  if (!locationId || !date) {
    return NextResponse.json({ error: 'locationId and date are required.' }, { status: 400 });
  }

  let derivedBusinessId: string | null = null;

  try {
    const locs = await imsQuery<{ name: string; business_id: string | null }>(
      'SELECT name, business_id FROM ims_locations WHERE id = ? LIMIT 1',
      [locationId],
    );
    const locationName = locs[0]?.name ?? `Location ${locationId}`;
    const businessId = adminSession?.businessId ?? locs[0]?.business_id ?? null;
    derivedBusinessId = businessId;
    if (boundSession?.businessId && businessId && boundSession.businessId !== businessId) {
      return NextResponse.json({ error: 'Unauthorised.' }, { status: 403 });
    }
    if (!businessId) {
      return NextResponse.json({ error: 'Could not determine business for this location.' }, { status: 400 });
    }

    let registerName: string | null = null;
    if (registerId) {
      const regs = await imsQuery<{ name: string }>('SELECT name FROM pos_registers WHERE id = ? LIMIT 1', [registerId]);
      registerName = regs[0]?.name ?? null;
    }

    const rows = await PosEodRepo.get(locationId, date, registerId ?? null);

    const results = await triggerEodXeroSync(
      businessId,
      locationId,
      date,
      rows,
      locationName,
      registerId ?? null,
      {
        setXeroInvoice: PosEodRepo.setXeroInvoice.bind(PosEodRepo),
        setXeroPayment: PosEodRepo.setXeroPayment.bind(PosEodRepo),
        setXeroPaymentError: PosEodRepo.setXeroPaymentError.bind(PosEodRepo),
      },
      registerName,
    );

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('EOD Xero sync error:', err);
    const businessId = adminSession?.businessId ?? derivedBusinessId;
    if (businessId) {
      await notifySyncFailure({
        businessId,
        source: 'xero_sync',
        title: 'Xero Sync Failed — POS EOD',
        message: `POS EOD sync failed for location ${locationId} on ${date}. ${err?.message ?? 'Unknown error'}`,
        detail: { location_id: locationId, date, register_id: registerId ?? null, error: err?.message ?? String(err) },
        dedupeKey: `xero:eod:${locationId}:${date}:${registerId ?? 'all'}`,
        dedupeMinutes: 60,
      }).catch(() => {});
    }
    return NextResponse.json({ error: err.message ?? 'Sync failed.' }, { status: 500 });
  }
}
