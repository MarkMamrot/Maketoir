/**
 * POST /api/pos/xero/sync-eod
 * Body: { locationId: number, date: string }
 *
 * Manual trigger / retry for EOD → Xero sync.
 * The same logic runs automatically on POST /api/pos/eod (register close).
 * Requires marketoir_session for businessId.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { PosEodRepo } from '@/lib/db/PosRepository';
import { triggerEodXeroSync } from '@/services/XeroSyncService';
import { imsQuery } from '@/services/IMSMySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { locationId, date, registerId } = await req.json();
  if (!locationId || !date) {
    return NextResponse.json({ error: 'locationId and date are required.' }, { status: 400 });
  }

  try {
    const locs = await imsQuery<{ name: string }>('SELECT name FROM ims_locations WHERE id = ? LIMIT 1', [locationId]);
    const locationName = locs[0]?.name ?? `Location ${locationId}`;

    let registerName: string | null = null;
    if (registerId) {
      const regs = await imsQuery<{ name: string }>('SELECT name FROM pos_registers WHERE id = ? LIMIT 1', [registerId]);
      registerName = regs[0]?.name ?? null;
    }

    const rows = await PosEodRepo.get(locationId, date, registerId ?? null);

    // Extract session ID from the stored reconciliation rows (set at save time)
    const registerSessionId = (rows as any[]).find(r => r.register_session_id != null)?.register_session_id ?? null;

    const results = await triggerEodXeroSync(
      user.businessId,
      locationId,
      date,
      rows,
      locationName,
      registerId ?? null,
      PosEodRepo.setXeroInvoice.bind(PosEodRepo),
      registerName,
      registerSessionId,
    );

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('EOD Xero sync error:', err);
    return NextResponse.json({ error: err.message ?? 'Sync failed.' }, { status: 500 });
  }
}
