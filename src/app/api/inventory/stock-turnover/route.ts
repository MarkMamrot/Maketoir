import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getProductsWithSales, getSuppliers } from '@/lib/dataProvider';
import type { StandardizedVariantWithSales, StandardizedContact } from '@/types/StandardizedData';

// ── Stock Turnover Efficiency ─────────────────────────────────────────────────
//
// Metrics per variant:
//   avgDailySales  = salesQty / salesWindowDays
//   dos            = qty_on_hand / avgDailySales   (Days of Stock; Infinity if no sales)
//   turnRate       = 365 / dos                     (annual turns)
//   capitalTied    = qty_on_hand * cost
//   capitalEff     = (avgDailySales * price) / capitalTied  (revenue/$ tied)
//   idealSoh       = avgDailySales * targetDos
//   excessStock    = max(0, soh - idealSoh)
//   excessCapital  = excessStock * cost
//
// Products are percentile-ranked by turnRate within the filtered set:
//   Top 20%    → A  Fast Mover
//   60–80th pc → B  Good
//   40–60th pc → C  Average
//   20–40th pc → D  Slow
//   Bottom 20% → E  Dead Stock
//
// Zero-sales products: dos = 999 (capped for display), grade '?' No Movement.

const DAY_MS = 24 * 60 * 60 * 1000;
const DOS_CAP = 999;

function round(v: number, p = 2): number {
  const f = 10 ** p;
  return Math.round(v * f) / f;
}

function percentileGrade(rank: number, total: number): { grade: string; stars: number; label: string } {
  const pct = rank / total;
  if (pct < 0.2) return { grade: 'A', stars: 5, label: 'Fast Mover'   };
  if (pct < 0.4) return { grade: 'B', stars: 4, label: 'Good'         };
  if (pct < 0.6) return { grade: 'C', stars: 3, label: 'Average'      };
  if (pct < 0.8) return { grade: 'D', stars: 2, label: 'Slow'         };
  return               { grade: 'E', stars: 1, label: 'Dead Stock'   };
}

export interface TurnoverRow {
  optionId:       string;
  productId:      string;
  code:           string;
  name:           string;
  brand:          string;
  supplierId:     string;
  supplierName:   string;
  soh:            number;
  cost:           number;
  price:          number | null;
  salesQty:       number;
  avgDailySales:  number;
  dos:            number;        // capped at DOS_CAP for display
  dosRaw:         number;        // raw value for sorting (may be Infinity)
  turnRate:       number;
  capitalTied:    number;
  capitalEff:     number | null; // null when capitalTied = 0
  excessCapital:  number;
  targetDosUsed:  number;
  grade:          string;
  stars:          number;
  label:          string;
}

const SALES_WINDOW_FIELDS: Record<number, keyof StandardizedVariantWithSales> = {
  7:   'sales_qty_7d',
  90:  'sales_qty_90d',
  180: 'sales_qty_180d',
  365: 'sales_qty_12m',
};

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await req.json();
  const databaseId: string      = String(body?.databaseId      ?? '').trim();
  const filterType: string      = body?.filterType === 'brand' ? 'brand' : 'supplier';
  const filterValue: string     = String(body?.filterValue     ?? '').trim();
  const salesWindowDays: number = Number(body?.salesWindowDays)  || 90;
  const targetDos: number       = Number(body?.targetDos)        || 60;
  const excludeNewItems: boolean = Boolean(body?.excludeNewItems);

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }

  let products: StandardizedVariantWithSales[];
  let suppliers: StandardizedContact[];
  try {
    [products, suppliers] = await Promise.all([
      getProductsWithSales(databaseId),
      getSuppliers(databaseId).catch(() => [] as StandardizedContact[]),
    ]);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load data: ${e.message}` }, { status: 500 });
  }

  // Build supplier name map
  const supplierNameMap = new Map<string, string>();
  const supplierFreqMap = new Map<string, number>();
  for (const s of suppliers) {
    supplierNameMap.set(s.source_id, s.company || s.name || `Supplier ${s.source_id}`);
    if (s.order_frequency_days != null) {
      supplierFreqMap.set(s.source_id, s.order_frequency_days);
    }
  }

  const now = Date.now();
  const salesField = SALES_WINDOW_FIELDS[salesWindowDays] ?? 'sales_qty_90d';

  const brandSet    = new Set<string>();
  const supplierSet = new Set<string>();
  const allRows: TurnoverRow[] = [];
  let totalSalesOverPeriod = 0;

  for (const p of products) {
    const brand      = p.brand ?? '';
    const supplierId = p.supplier_id ?? '';

    // Age-adjust the sales window like order planner does
    const createdAt   = p.created_date ? new Date(p.created_date).getTime() : NaN;
    
    if (excludeNewItems && Number.isFinite(createdAt)) {
      if ((now - createdAt) < (salesWindowDays * DAY_MS)) {
        continue; // Skip items created within the sales window
      }
    }

    if (brand)      brandSet.add(brand);
    if (supplierId) supplierSet.add(supplierId);

    if (filterValue) {
      if (filterType === 'brand'    && brand      !== filterValue) continue;
      if (filterType === 'supplier' && supplierId !== filterValue) continue;
    }

    const soh         = Number(p.qty_on_hand ?? 0);
    const cost        = Number(p.cost ?? 0);
    const price       = p.price != null ? Number(p.price) : null;
    const salesQty    = round(Number((p as any)[salesField] ?? 0), 4);
    totalSalesOverPeriod += salesQty;

    const stockDays   = Number.isFinite(createdAt)
      ? Math.max(0, Math.floor((now - createdAt) / DAY_MS))
      : salesWindowDays;
    const effectiveDays = Math.min(salesWindowDays, stockDays || salesWindowDays);

    const avgDailySales = effectiveDays > 0 ? round(salesQty / effectiveDays, 6) : 0;

    const dosRaw    = avgDailySales > 0 ? soh / avgDailySales : Infinity;
    const dos       = Number.isFinite(dosRaw) ? round(Math.min(dosRaw, DOS_CAP), 1) : DOS_CAP;
    const turnRate  = Number.isFinite(dosRaw) && dosRaw > 0 ? round(365 / dosRaw, 2) : 0;

    const capitalTied  = round(soh * cost, 2);
    const capitalEff   = capitalTied > 0 && price != null
      ? round((avgDailySales * price) / capitalTied, 4)
      : null;
      
    const effectiveTargetDos = supplierFreqMap.get(supplierId) ?? targetDos;
    const idealSoh = avgDailySales * effectiveTargetDos;
    const excessStock = Math.max(0, soh - idealSoh);
    const excessCapital = round(excessStock * cost, 2);

    allRows.push({
      optionId:      p.source_id,
      productId:     p.parent_source_id ?? p.source_id,
      code:          p.sku ?? '',
      name:          p.name,
      brand,
      supplierId,
      supplierName:  supplierNameMap.get(supplierId) ?? (supplierId ? `Supplier ${supplierId}` : 'Unassigned'),
      soh,
      cost,
      price,
      salesQty:      round(salesQty, 2),
      avgDailySales: round(avgDailySales, 4),
      dos,
      dosRaw,
      turnRate,
      capitalTied,
      capitalEff,
      excessCapital,
      targetDosUsed: effectiveTargetDos,
      grade: '', stars: 0, label: '',
    });
  }

  // Separate movers (has sales) from no-movers (zero avgDailySales)
  const movers   = allRows.filter(r => r.avgDailySales > 0).sort((a, b) => b.turnRate - a.turnRate);
  const noMovers = allRows.filter(r => r.avgDailySales <= 0);

  movers.forEach((row, i) => {
    const { grade, stars, label } = percentileGrade(i, movers.length || 1);
    row.grade = grade;
    row.stars = stars;
    row.label = label;
  });
  noMovers.forEach(row => { row.grade = '?'; row.stars = 0; row.label = 'No Movement'; });

  const options = {
    brands:    [...brandSet].sort((a, b) => a.localeCompare(b)),
    // Use the full suppliers list (not just those referenced in products) so the dropdown is
    // always populated even when ims_products.supplier_contact_id is not set.
    suppliers: suppliers.length > 0
      ? suppliers
          .map(s => ({ id: s.source_id, label: s.company || s.name || `Supplier ${s.source_id}` }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [...supplierSet]
          .map(id => ({ id, label: supplierNameMap.get(id) ?? `Supplier ${id}` }))
          .sort((a, b) => a.label.localeCompare(b.label)),
  };

  // Default sort: excessCapital descending (worst offenders first)
  const resultRows = [...movers.sort((a, b) => b.excessCapital - a.excessCapital), ...noMovers.sort((a, b) => b.excessCapital - a.excessCapital)];

  const totalCapitalTied = round(resultRows.reduce((s, r) => s + r.capitalTied, 0), 2);
  const movingRows       = resultRows.filter(r => r.avgDailySales > 0);
  const avgDos           = movingRows.length > 0
    ? round(movingRows.reduce((s, r) => s + r.dos, 0) / movingRows.length, 1)
    : 0;
  const avgTurnRate      = movingRows.length > 0
    ? round(movingRows.reduce((s, r) => s + r.turnRate, 0) / movingRows.length, 2)
    : 0;
  // Worst offender = highest excessCapital with meaningful capital tied (>$0)
  const worstOffender = [...resultRows]
    .filter(r => r.capitalTied > 0)
    .sort((a, b) => b.excessCapital - a.excessCapital)[0] ?? resultRows[0] ?? null;

  return NextResponse.json({
    success: true,
    options,
    rows: resultRows,
    summary: {
      totalProducts:    resultRows.length,
      movingProducts:   movingRows.length,
      noMovementCount:  noMovers.length,
      totalCapitalTied,
      totalSales:       round(totalSalesOverPeriod, 0),
      avgDos,
      avgTurnRate,
      worstName:        worstOffender?.name ?? '',
      worstExcessCapital: worstOffender?.excessCapital ?? 0,
    },
  });
}
