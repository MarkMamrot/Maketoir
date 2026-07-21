import { NextResponse } from 'next/server';
import { getProductsWithSales, getSuppliers } from '@/lib/dataProvider';
import type { StandardizedVariantWithSales, StandardizedContact } from '@/types/StandardizedData';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

// ── Stock Turnover Efficiency ─────────────────────────────────────────────────
//
// Metrics per variant:
//   avgDailySales     = salesQty / salesWindowDays
//   dos               = qty_on_hand / avgDailySales  (Days of Stock; Infinity if no sales)
//   turnRate          = 365 / dos                    (annual turns)
//   capitalTied       = qty_on_hand * cost
//   capitalEff        = (avgDailySales * price) / capitalTied  (revenue/$ tied)
//
// Excess is measured against the supplier's Order Frequency window — the stock we
// need to carry to last until the next order. Anything beyond that is excess:
//   orderWindow       = supplier order_frequency_days (if > 0) else targetDos fallback
//   idealSoh          = avgDailySales * orderWindow
//   excessStock       = max(0, soh - idealSoh)                  (units of dead weight)
//   excessCapital     = excessStock * cost                      ($ locked beyond window)
//   daysToClearExcess = excessStock / avgDailySales             (= dosRaw - orderWindow)
//   deadCapitalYears  = excessCapital * (daysToClearExcess / 365)
//                       → dollar-years of dead capital; the clearance-priority driver.
//
// The rating weighs both magnitude ($) and how long the capital stays stuck:
//   huge excess clearing in 2 days  → tiny deadCapitalYears → low priority
//   moderate excess taking 6 months → large                 → high priority
//   6 months to clear but 1-2 cheap items → tiny            → low priority
//
// Zero-sales products with stock are dead weight by definition → Critical.

const DAY_MS = 24 * 60 * 60 * 1000;
const DOS_CAP = 999;
const CLEAR_CAP = 999; // display cap for daysToClearExcess

// ── Clearance-priority rating ─────────────────────────────────────────────────
// Absolute thresholds on deadCapitalYears ($ of capital tied up for a year-equivalent),
// with a low-value floor so trivial/cheap items are never flagged as urgent.
const RATING_LOW_VALUE_FLOOR = 200;    // excessCapital below this can't rank worse than 'Low'
const RATING_CRITICAL = 4000;          // deadCapitalYears bands
const RATING_HIGH     = 1200;
const RATING_MODERATE = 300;
const RATING_LOW      = 40;

function round(v: number, p = 2): number {
  const f = 10 ** p;
  return Math.round(v * f) / f;
}

function computeRating(opts: {
  excessStock: number;
  excessCapital: number;
  deadCapitalYears: number;
  hasSales: boolean;
  soh: number;
}): { rating: string; ratingRank: number; label: string } {
  const { excessStock, excessCapital, deadCapitalYears, hasSales, soh } = opts;

  // No sales but holding stock → capital fully stuck, nothing clearing it.
  if (!hasSales) {
    return soh > 0
      ? { rating: 'critical', ratingRank: 4, label: 'Critical' }
      : { rating: 'healthy',  ratingRank: 0, label: 'Healthy'  };
  }

  // Stock is within the order-frequency window — nothing excess.
  if (excessStock <= 0) {
    return { rating: 'healthy', ratingRank: 0, label: 'Healthy' };
  }

  // Cheap excess never ranks urgent regardless of how slowly it clears.
  const cappedByValue = excessCapital < RATING_LOW_VALUE_FLOOR;

  let rating: string, ratingRank: number, label: string;
  if      (deadCapitalYears >= RATING_CRITICAL) { rating = 'critical'; ratingRank = 4; label = 'Critical'; }
  else if (deadCapitalYears >= RATING_HIGH)     { rating = 'high';     ratingRank = 3; label = 'High';     }
  else if (deadCapitalYears >= RATING_MODERATE) { rating = 'moderate'; ratingRank = 2; label = 'Moderate'; }
  else if (deadCapitalYears >= RATING_LOW)      { rating = 'low';      ratingRank = 1; label = 'Low';      }
  else                                          { rating = 'healthy';  ratingRank = 0; label = 'Healthy';  }

  if (cappedByValue && ratingRank > 1) {
    return { rating: 'low', ratingRank: 1, label: 'Low' };
  }
  return { rating, ratingRank, label };
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
  orderWindowDays:   number;     // supplier order frequency, or Target DOS fallback
  excessStock:       number;     // units beyond the order-frequency window
  excessCapital:     number;     // cost of the excess units
  daysToClearExcess: number;     // capped at CLEAR_CAP for display
  daysToClearRaw:    number;     // raw value for sorting (may be Infinity)
  deadCapitalYears:  number;     // excessCapital × daysToClear/365 — priority driver
  rating:            string;     // healthy | low | moderate | high | critical
  ratingRank:        number;     // 0..4 for sorting
  label:             string;
}

const SALES_WINDOW_FIELDS: Record<number, keyof StandardizedVariantWithSales> = {
  7:   'sales_qty_7d',
  90:  'sales_qty_90d',
  180: 'sales_qty_180d',
  365: 'sales_qty_12m',
};

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

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
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  let products: StandardizedVariantWithSales[];
  let suppliers: StandardizedContact[];
  try {
    [products, suppliers] = await Promise.all([
      getProductsWithSales(databaseId, 'solvantis'),
      getSuppliers(databaseId, 'solvantis').catch(() => [] as StandardizedContact[]),
    ]);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load data: ${e.message}` }, { status: 500 });
  }

  // Build supplier name map + order-frequency map (only positive frequencies are usable;
  // 0/negative/unset fall back to the Target DOS input).
  const supplierNameMap = new Map<string, string>();
  const supplierFreqMap = new Map<string, number>();
  for (const s of suppliers) {
    supplierNameMap.set(s.source_id, s.company || s.name || `Supplier ${s.source_id}`);
    if (s.order_frequency_days != null && s.order_frequency_days > 0) {
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

    // Excess is measured against the supplier's order-frequency window (stock needed to
    // last until the next order). Suppliers without a positive frequency fall back to Target DOS.
    const orderWindowDays = supplierFreqMap.get(supplierId) ?? targetDos;
    const idealSoh        = avgDailySales * orderWindowDays;
    const excessStock     = round(Math.max(0, soh - idealSoh), 2);
    const excessCapital   = round(excessStock * cost, 2);

    // Time to sell through the excess *beyond* the order window.
    const daysToClearRaw = avgDailySales > 0
      ? (excessStock > 0 ? excessStock / avgDailySales : 0)
      : (soh > 0 ? Infinity : 0);
    const daysToClearExcess = Number.isFinite(daysToClearRaw)
      ? round(Math.min(daysToClearRaw, CLEAR_CAP), 1)
      : CLEAR_CAP;

    // Dollar-years of dead capital: how much cash is stuck and for how long.
    const deadCapitalYears = Number.isFinite(daysToClearRaw)
      ? round(excessCapital * (daysToClearRaw / 365), 2)
      : round(capitalTied, 2); // no-sales: whole holding is dead for the foreseeable future

    const { rating, ratingRank, label } = computeRating({
      excessStock,
      excessCapital,
      deadCapitalYears,
      hasSales: avgDailySales > 0,
      soh,
    });

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
      orderWindowDays,
      excessStock,
      excessCapital,
      daysToClearExcess,
      daysToClearRaw,
      deadCapitalYears,
      rating,
      ratingRank,
      label,
    });
  }

  // Rating is computed per-row above. Split movers/no-movers only for summary stats.
  const noMovers = allRows.filter(r => r.avgDailySales <= 0);

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

  // Default sort: highest clearance priority first (dead capital-years desc).
  const resultRows = [...allRows].sort((a, b) => b.deadCapitalYears - a.deadCapitalYears);

  const totalCapitalTied  = round(resultRows.reduce((s, r) => s + r.capitalTied, 0), 2);
  const totalExcessCapital = round(resultRows.reduce((s, r) => s + r.excessCapital, 0), 2);
  const movingRows        = resultRows.filter(r => r.avgDailySales > 0);
  const avgDos            = movingRows.length > 0
    ? round(movingRows.reduce((s, r) => s + r.dos, 0) / movingRows.length, 1)
    : 0;
  const avgTurnRate       = movingRows.length > 0
    ? round(movingRows.reduce((s, r) => s + r.turnRate, 0) / movingRows.length, 2)
    : 0;
  // Worst offender = highest dead capital-years (most cash stuck for longest).
  const worstOffender = resultRows.find(r => r.deadCapitalYears > 0) ?? resultRows[0] ?? null;

  return NextResponse.json({
    success: true,
    options,
    rows: resultRows,
    summary: {
      totalProducts:    resultRows.length,
      movingProducts:   movingRows.length,
      noMovementCount:  noMovers.length,
      totalCapitalTied,
      totalExcessCapital,
      totalSales:       round(totalSalesOverPeriod, 0),
      avgDos,
      avgTurnRate,
      worstName:          worstOffender?.name ?? '',
      worstExcessCapital: worstOffender?.excessCapital ?? 0,
      worstDaysToClear:   worstOffender?.daysToClearExcess ?? 0,
    },
  });
}
