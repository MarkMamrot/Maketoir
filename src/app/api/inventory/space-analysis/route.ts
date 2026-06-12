import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getInventorySource, getSuppliers } from '@/lib/dataProvider';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { getIMSPool } from '@/services/IMSMySQLService';

// ── Best-practice space efficiency (Sales per Unit of Space) ──────────────────
// Space Efficiency Index (SEI) = avgDailySales / volumeRating
//
// Products are percentile-ranked within the filtered set:
//   Top 20%    → A  Excellent
//   60–80th pc → B  Good
//   40–60th pc → C  Average
//   20–40th pc → D  Below Average
//   Bottom 20% → E  Poor

function parseNumber(value: unknown): number {
  const num = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percentileRating(rank: number, total: number): { grade: string; stars: number; label: string } {
  const pct = rank / total; // 0 = best, 1 = worst
  if (pct < 0.2)  return { grade: 'A', stars: 5, label: 'Excellent'      };
  if (pct < 0.4)  return { grade: 'B', stars: 4, label: 'Good'           };
  if (pct < 0.6)  return { grade: 'C', stars: 3, label: 'Average'        };
  if (pct < 0.8)  return { grade: 'D', stars: 2, label: 'Below Average'  };
  return           { grade: 'E', stars: 1, label: 'Poor'            };
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await req.json();
  const databaseId: string    = String(body?.databaseId ?? '').trim();
  const filterType: string    = body?.filterType === 'brand' ? 'brand' : 'supplier';
  const filterValue: string   = String(body?.filterValue ?? '').trim();
  const salesWindowDays: number = Number(body?.salesWindowDays) || 90;
  const activeOnly: boolean   = body?.activeOnly !== false;

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }

  const source = await getInventorySource(databaseId).catch(() => 'cin7');

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const brandSet    = new Set<string>();
  const supplierSet = new Set<string>();
  const supplierNameMap = new Map<string, string>();

  type SpaceRow = {
    productId: string;
    optionId: string;
    code: string;
    name: string;
    brand: string;
    supplierId: string;
    supplierName: string;
    volumeRating: number;
    hasVolume: boolean;
    salesQty: number;
    avgDailySales: number;
    totalSOH: number;
    cost: number;
    sei: number;
    grade: string;
    stars: number;
    label: string;
  };

  const allRows: SpaceRow[] = [];

  try {
    if (source === 'solvantis') {
      // ── Solvantis path ─────────────────────────────────────────────────
      const pool = getIMSPool();
      const salesCol = salesWindowDays === 7   ? 'sc.sales_qty_7d'
                     : salesWindowDays === 90  ? 'sc.sales_qty_90d'
                     : salesWindowDays === 180 ? 'sc.sales_qty_180d'
                     :                           'sc.sales_qty_12m';

      const [rows] = await pool.query<any>(
        `SELECT
           v.variant_id                          AS optionId,
           p.product_id                          AS productId,
           v.sku                                 AS code,
           p.name,
           COALESCE(p.brand, '')                 AS brand,
           COALESCE(c.contact_id, '')            AS supplierId,
           COALESCE(c.company_name, '')          AS supplierName,
           v.volume                              AS volumeRating,
           COALESCE(sc.global_soh, 0)            AS totalSOH,
           COALESCE(${salesCol}, 0)              AS salesQty,
           COALESCE(v.cost, 0)                   AS cost,
           p.created_at                          AS createdDate,
           v.is_active                           AS isActive
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_sales_cache sc ON sc.variant_id = v.variant_id
         LEFT JOIN ims_contacts c ON c.contact_id = p.supplier_id
         WHERE v.is_active = 1 AND p.is_active = 1`,
        [],
      ) as any;

      for (const r of rows as any[]) {
        const brand      = String(r.brand ?? '').trim();
        const supplierId = String(r.supplierId ?? '').trim();
        if (brand)      brandSet.add(brand);
        if (supplierId) { supplierSet.add(supplierId); supplierNameMap.set(supplierId, String(r.supplierName ?? '').trim() || `Supplier ${supplierId}`); }

        if (filterValue) {
          if (filterType === 'brand'    && brand      !== filterValue) continue;
          if (filterType === 'supplier' && supplierId !== filterValue) continue;
        }

        const createdAt   = r.createdDate ? new Date(r.createdDate).getTime() : NaN;
        const stockDays   = Number.isFinite(createdAt) ? Math.max(0, Math.floor((now - createdAt) / DAY_MS)) : salesWindowDays;
        const effectiveDays = Math.min(salesWindowDays, stockDays || salesWindowDays);
        const salesQty    = round(Number(r.salesQty));
        const avgDailySales = effectiveDays > 0 ? round(salesQty / effectiveDays) : 0;

        const rawVol     = r.volumeRating != null ? Number(r.volumeRating) : 0;
        const volumeRating = rawVol >= 1 ? Math.min(10, Math.max(1, Math.round(rawVol))) : 0;
        const hasVolume  = volumeRating > 0;
        const sei        = hasVolume ? round(avgDailySales / volumeRating) : 0;

        allRows.push({
          productId:    String(r.productId ?? ''),
          optionId:     String(r.optionId ?? ''),
          code:         String(r.code ?? ''),
          name:         String(r.name ?? ''),
          brand,
          supplierId,
          supplierName: supplierNameMap.get(supplierId) ?? 'Unassigned',
          volumeRating,
          hasVolume,
          salesQty,
          avgDailySales,
          totalSOH:     Number(r.totalSOH),
          cost:         round(Number(r.cost)),
          sei,
          grade: '', stars: 0, label: '',
        });
      }
    } else {
      // ── Cin7 path ──────────────────────────────────────────────────────
      const inventorySystemId = await resolveInventorySystemId(databaseId);
      const [products, suppliers] = await Promise.all([
        ProductsRepository.list(inventorySystemId),
        getSuppliers(databaseId).catch(() => [] as any[]),
      ]);

      for (const sup of suppliers as any[]) {
        const id   = String(sup.id ?? sup.supplier_id ?? '').trim();
        const name = String(sup.company ?? sup.name ?? '').trim() || `Supplier ${id}`;
        if (id) supplierNameMap.set(id, name);
      }

      for (const p of products) {
        if (activeOnly && p.online === false) continue; // `online` used as active flag in Cin7

        const brand      = p.brand ?? '';
        const supplierId = p.supplier_id ?? '';
        if (brand)      brandSet.add(brand);
        if (supplierId) supplierSet.add(supplierId);

        if (filterValue) {
          if (filterType === 'brand'    && brand      !== filterValue) continue;
          if (filterType === 'supplier' && supplierId !== filterValue) continue;
        }

        const salesQty = round(
          salesWindowDays === 7   ? Number(p.sales_qty_7d)   :
          salesWindowDays === 90  ? Number(p.sales_qty_90d)  :
          salesWindowDays === 180 ? Number(p.sales_qty_180d) :
                                    Number(p.sales_qty_12m),
        );

        const createdAt = p.created_date ? new Date(p.created_date).getTime() : NaN;
        const stockDays = Number.isFinite(createdAt) ? Math.max(0, Math.floor((now - createdAt) / DAY_MS)) : salesWindowDays;
        const effectiveDays  = Math.min(salesWindowDays, stockDays || salesWindowDays);
        const avgDailySales  = effectiveDays > 0 ? round(salesQty / effectiveDays) : 0;

        const rawVol     = p.volume != null ? Number(p.volume) : 0;
        const volumeRating = rawVol >= 1 ? Math.min(10, Math.max(1, Math.round(rawVol))) : 0;
        const hasVolume  = volumeRating > 0;
        const sei        = hasVolume ? round(avgDailySales / volumeRating) : 0;

        allRows.push({
          productId:   p.cin7_id,
          optionId:    p.option_id,
          code:        p.code ?? '',
          name:        p.name ?? '',
          brand,
          supplierId,
          supplierName: supplierNameMap.get(supplierId) ?? (supplierId ? `Supplier ${supplierId}` : 'Unassigned'),
          volumeRating,
          hasVolume,
          salesQty,
          avgDailySales,
          totalSOH:    Number(p.global_soh),
          cost:        round(Number(p.cost ?? 0)),
          sei,
          grade: '', stars: 0, label: '',
        });
      }
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load data: ${e.message}` }, { status: 500 });
  }

  // Only rank rows that have a volume rating (others can't be compared fairly)
  const ranked = allRows.filter(r => r.hasVolume).sort((a, b) => b.sei - a.sei);
  const unranked = allRows.filter(r => !r.hasVolume);

  ranked.forEach((row, i) => {
    const { grade, stars, label } = percentileRating(i, ranked.length || 1);
    row.grade = grade;
    row.stars = stars;
    row.label = label;
  });

  unranked.forEach(row => {
    row.grade = '?';
    row.stars = 0;
    row.label = 'No volume set';
  });

  // Return ranked first (sorted by SEI desc), then unranked
  const resultRows = [...ranked, ...unranked];

  const options = {
    brands: [...brandSet].sort((a, b) => a.localeCompare(b)),
    suppliers: [...supplierSet]
      .map(id => ({ id, label: supplierNameMap.get(id) ?? `Supplier ${id}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };

  return NextResponse.json({
    success: true,
    options,
    rows: resultRows,
    summary: {
      totalRows: resultRows.length,
      rankedRows: ranked.length,
      unrankedRows: unranked.length,
      avgSei: ranked.length > 0 ? round(ranked.reduce((s, r) => s + r.sei, 0) / ranked.length) : 0,
    },
  });
}
