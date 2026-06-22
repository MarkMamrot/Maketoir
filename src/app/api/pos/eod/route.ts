import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosEodRepo } from '@/lib/db/PosRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { triggerEodXeroSync } from '@/services/XeroSyncService';
import { imsQuery } from '@/services/IMSMySQLService';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/eod?location_id=3&date=2025-06-02
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const rawId    = searchParams.get('location_id') ?? String(session.location_id);
  const locationId = parseInt(rawId, 10);

  if (!locationId || isNaN(locationId) || locationId !== session.location_id) {
    return NextResponse.json({ error: 'Invalid or unauthorised location_id.' }, { status: 400 });
  }

  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const adminRaw    = cookies().get('marketoir_session')?.value;
  const adminSession = adminRaw ? (() => { try { return JSON.parse(adminRaw); } catch { return null; } })() : null;
  const bizId = adminSession?.businessId ?? 'shared';

  const [existing, expected, floatRaw] = await Promise.all([
    PosEodRepo.get(locationId, date),
    PosEodRepo.getExpected(locationId, date),
    ConfigRepository.get(bizId, 'POS_DefaultFloat').catch(() => null),
  ]);

  const default_float = floatRaw !== null ? parseFloat(floatRaw) || 200 : 200;

  return NextResponse.json({ reconciliations: existing, expected, default_float });
}

// POST /api/pos/eod — save reconciliation entries
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  try {
    const body = await req.json();
    const { location_id, date, entries } = body;

    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: 'entries must be an array.' }, { status: 400 });
    }

    // Enforce session location — prevent a cashier from submitting EOD for another location
    const resolvedLocationId = Number(location_id ?? session.location_id);
    if (!resolvedLocationId || isNaN(resolvedLocationId) || resolvedLocationId !== session.location_id) {
      return NextResponse.json({ error: 'Invalid or unauthorised location_id.' }, { status: 403 });
    }

    const resolvedDate = date ?? new Date().toISOString().slice(0, 10);

    const expected = await PosEodRepo.getExpected(resolvedLocationId, resolvedDate);

    for (const entry of entries) {
      await PosEodRepo.save({
        location_id:       resolvedLocationId,
        cashier_id:        session.pos_user_id,
        recon_date:        resolvedDate,
        payment_method:    entry.payment_method,
        expected_amount:   expected[entry.payment_method] ?? 0,
        counted_amount:    entry.counted_amount ?? null,
        opening_float:     entry.opening_float  ?? null,
        denomination_data: entry.denomination_data ?? null,
        notes:             entry.notes ?? null,
      });
    }

    // Auto-trigger Xero sync on EOD close (fire-and-forget — requires admin session for businessId)
    const adminRaw     = cookies().get('marketoir_session')?.value;
    const adminSession = adminRaw ? (() => { try { return JSON.parse(adminRaw); } catch { return null; } })() : null;
    if (adminSession?.businessId) {
      // Only sync entries that have a counted_amount (actual EOD close, not just opening float)
      const hasCount = entries.some((e: any) => e.counted_amount != null);
      if (hasCount) {
        imsQuery<{ name: string }>('SELECT name FROM ims_locations WHERE id = ? LIMIT 1', [resolvedLocationId])
          .then(locs => {
            const locationName = locs[0]?.name ?? `Location ${resolvedLocationId}`;
            return PosEodRepo.get(resolvedLocationId, resolvedDate).then(rows =>
              triggerEodXeroSync(
                adminSession.businessId,
                resolvedLocationId,
                resolvedDate,
                rows,
                locationName,
                PosEodRepo.setXeroInvoice.bind(PosEodRepo),
              )
            );
          })
          .catch(e => console.error('EOD Xero auto-sync failed:', e.message));
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS EOD save error:', err);
    return NextResponse.json({ error: 'Failed to save EOD reconciliation.' }, { status: 500 });
  }
}
