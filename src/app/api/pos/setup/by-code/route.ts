import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';
import { checkRateLimit, registerFailure, clearRateLimit } from '@/lib/posRateLimit';

// POST /api/pos/setup/by-code
// Body: { code }
// Unauthenticated device-enrolment endpoint: looks up a location by its
// pos_location_code across ALL tenant schemas. The code identifies both the
// business and the location, so no session or dropdown is needed.
// Rate-limited (the code is the enrolment secret).
export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    const trimmed = String(code ?? '').trim();
    if (!trimmed || trimmed.length < 6) {
      return NextResponse.json({ error: 'Enter the location code (at least 6 characters).' }, { status: 400 });
    }

    // Global rate limit on this endpoint to slow code brute-forcing.
    const rlKey = 'setup-by-code';
    const rl = checkRateLimit(rlKey);
    if (rl.locked) {
      return NextResponse.json(
        { error: `Too many incorrect attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).` },
        { status: 429 },
      );
    }

    // Collect all tenant schemas: env default + every mapped business.
    const schemas = new Set<string>();
    if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
    try {
      const rows = await query<{ ims_db_name: string | null }>(
        'SELECT ims_db_name FROM businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL',
      );
      for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
    } catch { /* main DB unavailable — fall through with env default only */ }

    for (const schema of schemas) {
      let loc: { id: number; name: string; business_id: string | null } | undefined;
      try {
        const rows = await imsQuery<{ id: number; name: string; business_id: string | null }>(
          'SELECT id, name, business_id FROM ims_locations WHERE pos_location_code = ? AND is_active = 1 LIMIT 1',
          [trimmed],
          schema, // explicit db — no session exists during device setup
        );
        loc = rows[0];
      } catch { continue; /* schema missing column/table — skip */ }
      if (!loc) continue;

      clearRateLimit(rlKey);
      const registers = await imsQuery<{ id: number; name: string; default_float: number; is_active: number }>(
        'SELECT id, name, default_float, is_active FROM pos_registers WHERE location_id = ? AND is_active = 1 ORDER BY id',
        [loc.id],
        schema,
      );
      return NextResponse.json({
        success:       true,
        business_id:   loc.business_id,
        location_id:   loc.id,
        location_name: loc.name,
        registers:     registers.map(r => ({ id: r.id, name: r.name, default_float: Number(r.default_float) })),
      });
    }

    const after = registerFailure(rlKey);
    const msg = after.locked
      ? `Too many incorrect attempts. Try again in ${Math.ceil(after.retryAfterSec / 60)} minute(s).`
      : 'Location code not recognised. Check with your manager.';
    return NextResponse.json({ error: msg }, { status: after.locked ? 429 : 404 });
  } catch (err: any) {
    console.error('POS setup by-code error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
