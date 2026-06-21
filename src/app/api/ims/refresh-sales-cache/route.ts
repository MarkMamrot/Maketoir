import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

function getBusinessId(): string | null {
  try {
    const s = cookies().get('marketoir_session');
    if (!s?.value) return null;
    return JSON.parse(s.value)?.businessId ?? null;
  } catch {
    return null;
  }
}

/** GET — returns cache status: row count + last updated_at */
export async function GET() {
  const businessId = getBusinessId();
  if (!businessId) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const rows = await imsQuery<{ count: number; updatedAt: string | null }>(
      `SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM ims_sales_cache WHERE business_id = ?`,
      [businessId],
    );
    return NextResponse.json({ success: true, count: rows[0]?.count ?? 0, updatedAt: rows[0]?.updatedAt ?? null });
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json({ success: false, error: 'ims_sales_cache table not found. Run the IMS schema update.' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/** POST — recomputes sales aggregates + global stock and upserts into ims_sales_cache */
export async function POST() {
  if (!getBusinessId()) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const updatedCount = await refreshVariantCache();
    const refreshedAt = new Date().toISOString();
    return NextResponse.json({ success: true, variantsUpdated: updatedCount, refreshedAt });

  } catch (err: any) {
    console.error('[refresh-sales-cache POST] Error:', err?.message, err?.code, err?.sql);
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json(
        { success: false, error: 'ims_sales_cache table not found. Run the IMS schema update first.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
