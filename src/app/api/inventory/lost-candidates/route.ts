import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProductsRepository, StockRepository } from '@/lib/db/ProductsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { getInventorySource } from '@/lib/dataProvider';
import { getIMSPool } from '@/services/IMSMySQLService';

export interface LostCandidate {
  id: string;
  styleCode: string;
  name: string;
  brand: string;
  category: string;
  code: string;
  cost: string;
  retailPrice: string;
  branch: string;
  soh: number;
  qty180: number;
  lastSold: string;
}

/**
 * POST /api/inventory/lost-candidates
 * Body: { databaseId: string }
 *
 * Returns per-branch rows where:
 *  1. Branch SOH > 0 (stock exists at that specific branch)
 *  2. Global 180d sales = 0 (product has sold nothing globally in 6 months)
 *     — used as a conservative proxy for per-branch 180d = 0
 *
 * Data source: Cin7 MySQL cache OR Solvantis IMS MySQL.
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId } = await req.json();
  const _u = JSON.parse(session.value);
  if (!databaseId || databaseId !== _u.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  const source = await getInventorySource(databaseId).catch(() => 'cin7');
  const candidates: LostCandidate[] = [];
  const branchesWithCandidates = new Set<string>();

  try {
    if (source === 'solvantis') {
      // ── Solvantis: query IMS stock + sales cache ──────────────────────
      const pool = getIMSPool();
      const [rows] = await pool.query<any>(
        `SELECT
           v.variant_id                       AS id,
           COALESCE(p.style_code, '')         AS styleCode,
           p.name,
           COALESCE(p.brand, '')              AS brand,
           v.sku                              AS code,
           COALESCE(v.cost_aud, 0)           AS cost,
           COALESCE(v.price_rrp, 0)          AS retailPrice,
           l.name                             AS branchName,
           COALESCE(s.qty_on_hand, 0)         AS soh,
           COALESCE(sc.sales_qty_180d, 0)     AS qty180
         FROM ims_stock s
         JOIN ims_locations l     ON l.id = s.location_id
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p      ON p.product_id = v.product_id
         LEFT JOIN ims_sales_cache sc ON sc.variant_id = v.variant_id
         WHERE s.qty_on_hand > 0
           AND COALESCE(sc.sales_qty_180d, 0) = 0
           AND v.is_active = 1
           AND p.is_active = 1`,
        [],
      ) as any;

      for (const r of rows as any[]) {
        const branch = String(r.branchName ?? '');
        branchesWithCandidates.add(branch);
        candidates.push({
          id:          String(r.id),
          styleCode:   String(r.styleCode ?? ''),
          name:        String(r.name ?? ''),
          brand:       String(r.brand ?? ''),
          category:    '',
          code:        String(r.code ?? ''),
          cost:        String(r.cost ?? ''),
          retailPrice: String(r.retailPrice ?? ''),
          branch,
          soh:         Number(r.soh),
          qty180:      0,
          lastSold:    '',
        });
      }
    } else {
      // ── Cin7: use ProductsRepository + StockRepository ────────────────
      const inventorySystemId = await resolveInventorySystemId(databaseId);
      const [products, stockRows] = await Promise.all([
        ProductsRepository.list(inventorySystemId),
        StockRepository.list(inventorySystemId),
      ]);

      // Build lookup: option_id → product data
      const productMap = new Map(products.map(p => [p.option_id, p]));

      for (const s of stockRows) {
        if (Number(s.soh) <= 0) continue;
        const product = productMap.get(s.product_option_id ?? '');
        if (!product) continue;
        if (Number(product.sales_qty_180d) > 0) continue; // not lost globally

        const branch = s.branch_name ?? '';
        branchesWithCandidates.add(branch);
        candidates.push({
          id:          product.cin7_id,
          styleCode:   product.style_code ?? '',
          name:        product.name ?? '',
          brand:       product.brand ?? '',
          category:    '',
          code:        product.code ?? '',
          cost:        String(product.cost ?? ''),
          retailPrice: String(product.retail_price ?? ''),
          branch,
          soh:         Number(s.soh),
          qty180:      0,
          lastSold:    '',
        });
      }
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load data: ${e.message}` }, { status: 500 });
  }

  candidates.sort((a, b) => a.branch.localeCompare(b.branch) || a.styleCode.localeCompare(b.styleCode));

  return NextResponse.json({
    success: true,
    count: candidates.length,
    candidates,
    branches: Array.from(branchesWithCandidates).sort(),
    spreadsheetUrl: null,
  });
}

