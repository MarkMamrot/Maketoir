import { NextResponse } from 'next/server';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { getInventorySource } from '@/lib/dataProvider';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

export interface InactiveCandidate {
  id: string;
  styleCode: string;
  name: string;
  brand: string;
  category: string;
  optionId: string;
  code: string;
  cost: string;
  retailPrice: string;
  createdDate: string;
  totalSOH: number;
  total12mQty: number;
}

/**
 * POST /api/inventory/inactive-candidates
 * Body: { databaseId: string }
 *
 * Returns variants that meet ALL three criteria:
 *  1. Total SOH across all branches = 0
 *  2. Created more than 2 years ago
 *  3. No sales in the last 12 months
 *
 * Data source: Cin7 MySQL cache OR Solvantis IMS MySQL (based on inventory_source config).
 */
export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId } = await req.json();
  if (!databaseId || databaseId !== session.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  const source = await getInventorySource(databaseId).catch(() => 'cin7');
  const twoYearsAgoTs = Date.now() - 2 * 365 * 86_400_000;
  const twoYearsAgoDate = new Date(twoYearsAgoTs).toISOString().slice(0, 10);

  let candidates: InactiveCandidate[] = [];

  try {
    if (source === 'solvantis') {
      const pool = getIMSPool();
      const [rows] = await pool.query<any>(
        `SELECT
           v.variant_id                          AS id,
           v.variant_id                          AS optionId,
           v.sku                                 AS code,
           COALESCE(p.style_code, '')            AS styleCode,
           p.name,
           COALESCE(p.brand, '')                 AS brand,
           COALESCE(v.cost_aud, 0)               AS cost,
           COALESCE(v.price_rrp, 0)              AS retailPrice,
           DATE(p.created_at)                    AS createdDate,
           COALESCE(sc.global_soh,     0)        AS totalSOH,
           COALESCE(sc.sales_qty_12m,  0)        AS total12mQty
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_sales_cache sc ON sc.variant_id = v.variant_id
         WHERE v.is_active = 1
           AND p.is_active = 1
           AND DATE(p.created_at) < ?
           AND COALESCE(sc.global_soh,    0) = 0
           AND COALESCE(sc.sales_qty_12m, 0) = 0`,
        [twoYearsAgoDate],
      ) as any;

      candidates = (rows as any[]).map(r => ({
        id:          String(r.id),
        styleCode:   String(r.styleCode ?? ''),
        name:        String(r.name ?? ''),
        brand:       String(r.brand ?? ''),
        category:    '',
        optionId:    String(r.optionId),
        code:        String(r.code ?? ''),
        cost:        String(r.cost ?? ''),
        retailPrice: String(r.retailPrice ?? ''),
        createdDate: String(r.createdDate ?? '').slice(0, 10),
        totalSOH:    0,
        total12mQty: 0,
      }));
    } else {
      // Cin7 — read from MySQL cache
      const inventorySystemId = await resolveInventorySystemId(databaseId);
      const products = await ProductsRepository.list(inventorySystemId);

      candidates = products
        .filter(p => {
          if (!p.created_date) return false;
          const ts = new Date(p.created_date).getTime();
          if (isNaN(ts) || ts > twoYearsAgoTs) return false;
          if (Number(p.global_soh) > 0) return false;
          if (Number(p.sales_qty_12m) > 0) return false;
          return true;
        })
        .map(p => ({
          id:          p.cin7_id,
          styleCode:   p.style_code ?? '',
          name:        p.name ?? '',
          brand:       p.brand ?? '',
          category:    '',
          optionId:    p.option_id,
          code:        p.code ?? '',
          cost:        String(p.cost ?? ''),
          retailPrice: String(p.retail_price ?? ''),
          createdDate: p.created_date?.slice(0, 10) ?? '',
          totalSOH:    Number(p.global_soh),
          total12mQty: Number(p.sales_qty_12m),
        }));
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load data: ${e.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    count: candidates.length,
    candidates,
    spreadsheetUrl: null,
    spreadsheetId: null,
  });
}
