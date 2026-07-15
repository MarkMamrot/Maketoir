import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/**
 * GET /api/ims/supplier-brand-urls?brand=X&supplier=Y
 *
 * Returns the configured website URLs for a product's brand and supplier,
 * used by the Find URLs function to prioritise results from these domains.
 */
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  const { searchParams } = new URL(req.url);
  const brand    = searchParams.get('brand')    ?? '';
  const supplier = searchParams.get('supplier') ?? '';

  try {
    const [brandRows, supplierRows] = await Promise.all([
      brand
        ? imsQuery<{ website_url: string | null }>(
            `SELECT website_url FROM ims_brands WHERE business_id = ? AND name = ? LIMIT 1`,
            [businessId, brand],
          )
        : Promise.resolve([]),
      supplier
        ? imsQuery<{ website_url: string | null }>(
            `SELECT website_url FROM ims_contacts WHERE business_id = ? AND name = ? AND (type = 'supplier' OR type = 'both') LIMIT 1`,
            [businessId, supplier],
          )
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      success: true,
      brand_url:    brandRows[0]?.website_url    ?? null,
      supplier_url: supplierRows[0]?.website_url ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
