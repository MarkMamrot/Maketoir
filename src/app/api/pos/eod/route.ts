import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosEodRepo, PosRegistersRepo } from '@/lib/db/PosRepository';
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

  const date = searchParams.get('date') ?? new Date().toLocaleDateString('sv-SE');
  const registerId = searchParams.get('register_id') ? Number(searchParams.get('register_id')) : (session.register_id ?? null);
  const registerSessionId = searchParams.get('register_session_id') ? Number(searchParams.get('register_session_id')) : null;

  const adminRaw    = cookies().get('marketoir_session')?.value;
  const adminSession = adminRaw ? (() => { try { return JSON.parse(adminRaw); } catch { return null; } })() : null;
  const bizId = adminSession?.businessId ?? 'shared';

  // Get default_float: prefer per-register setting, fall back to global config
  let default_float = 200;
  if (registerId) {
    const reg = await PosRegistersRepo.get(registerId).catch(() => null);
    if (reg) default_float = reg.default_float;
  } else {
    const floatRaw = await ConfigRepository.get(bizId, 'POS_DefaultFloat').catch(() => null);
    if (floatRaw !== null) default_float = parseFloat(floatRaw) || 200;
  }

  // When a register session is supplied, reconcile by SESSION (open→close window),
  // which correctly handles shifts crossing midnight / registers left open overnight.
  if (registerSessionId) {
    const fallback = registerId != null ? { locationId, date, registerId } : undefined;
    const [existing, expected, dayTotals] = await Promise.all([
      PosEodRepo.get(locationId, date, registerId),
      PosEodRepo.getExpectedBySession(registerSessionId, fallback),
      PosEodRepo.getDayTotalsBySession(registerSessionId, fallback),
    ]);
    return NextResponse.json({ reconciliations: existing, expected, default_float, day_totals: dayTotals });
  }

  const [existing, expected, dayTotalsRows] = await Promise.all([
    PosEodRepo.get(locationId, date, registerId),
    PosEodRepo.getExpected(locationId, date, registerId),
    imsQuery<{ total_inc_tax: string; tax_total: string; total_exc_tax: string; sale_count: string }>(
      registerId != null
        ? `SELECT COALESCE(SUM(total), 0) AS total_inc_tax,
                  COALESCE(SUM(tax_total), 0) AS tax_total,
                  COALESCE(SUM(total - tax_total), 0) AS total_exc_tax,
                  COUNT(*) AS sale_count
           FROM pos_sales
           WHERE location_id = ? AND register_id = ? AND DATE(completed_at) = ?
             AND status IN ('completed','layby_complete')`
        : `SELECT COALESCE(SUM(total), 0) AS total_inc_tax,
                  COALESCE(SUM(tax_total), 0) AS tax_total,
                  COALESCE(SUM(total - tax_total), 0) AS total_exc_tax,
                  COUNT(*) AS sale_count
           FROM pos_sales
           WHERE location_id = ? AND DATE(completed_at) = ?
             AND status IN ('completed','layby_complete')`,
      registerId != null ? [locationId, registerId, date] : [locationId, date],
    ),
  ]);

  const dt = dayTotalsRows[0] ?? { total_inc_tax: '0', tax_total: '0', total_exc_tax: '0', sale_count: '0' };
  const day_totals = {
    total_inc_tax: parseFloat(dt.total_inc_tax) || 0,
    tax_total:     parseFloat(dt.tax_total)     || 0,
    total_exc_tax: parseFloat(dt.total_exc_tax) || 0,
    sale_count:    parseInt(dt.sale_count)       || 0,
  };

  return NextResponse.json({ reconciliations: existing, expected, default_float, day_totals });
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

    const resolvedDate = date ?? new Date().toLocaleDateString('sv-SE');
    const register_id = body.register_id ?? session.register_id ?? null;
    const register_session_id = body.register_session_id ?? null;

    // Expected takings: by session when supplied (handles midnight rollover), else by date.
    const expected = register_session_id
      ? await PosEodRepo.getExpectedBySession(Number(register_session_id))
      : await PosEodRepo.getExpected(resolvedLocationId, resolvedDate, register_id);

    for (const entry of entries) {
      await PosEodRepo.save({
        location_id:       resolvedLocationId,
        register_id:       register_id,
        register_session_id: register_session_id,
        cashier_id:        session.pos_user_id || null,
        cashier_name:      session.full_name || session.username || null,
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
        const sessionId = register_session_id ? Number(register_session_id) : null;
        imsQuery<{ name: string }>('SELECT name FROM ims_locations WHERE id = ? LIMIT 1', [resolvedLocationId])
          .then(async locs => {
            const locationName = locs[0]?.name ?? `Location ${resolvedLocationId}`;
            let registerName: string | null = null;
            if (register_id) {
              const regs = await imsQuery<{ name: string }>('SELECT name FROM pos_registers WHERE id = ? LIMIT 1', [register_id]);
              registerName = regs[0]?.name ?? null;
            }
            return PosEodRepo.get(resolvedLocationId, resolvedDate, register_id).then(rows =>
              triggerEodXeroSync(
                adminSession.businessId,
                resolvedLocationId,
                resolvedDate,
                rows,
                locationName,
                register_id,
                PosEodRepo.setXeroInvoice.bind(PosEodRepo),
                registerName,
                sessionId,
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
