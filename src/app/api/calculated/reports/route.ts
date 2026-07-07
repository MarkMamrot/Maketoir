/**
 * /api/calculated/reports
 *
 * POST ?databaseId=...
 *   Aggregates Brand Summary, Revenue per Branch, Slow Sellers, Sales by Month, etc.
 *   from MySQL data, saves results to calc_reports table.
 *
 * GET ?databaseId=...
 *   Reads saved reports from calc_reports and returns them as structured data + text.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleAnalyticsService } from '@/services/GoogleAnalyticsService';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { CalcReportsRepository, YearlyRevenueRepository } from '@/lib/db/CalcReportsRepository';

// -- helpers -------------------------------------------------------------------

function nc(v: unknown): string {
  return String(v ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNum(v: unknown): number {
  const s = String(v ?? '').replace(/[$,\s()]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseMoney(v: unknown): number {
  const raw = String(v ?? '').trim();
  const neg = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()$,\s]/g, '');
  if (!cleaned) return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

import { query as mysqlQuery } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';
import { getInventorySource } from '@/lib/dataProvider';

// ── IMS (Solvantis) data-source report calculations ──────────────────────────
// These query the IMS database directly (readyedu_MonsterthreadsIMS) via imsQuery,
// keyed by the IMS `business_id` which equals the Foresight databaseId.
// Revenue is GST-EXCLUSIVE: sales orders use `subtotal` (= SUM of line_total),
// POS uses `(total - tax_total)`. POS is scoped via ims_locations.business_id
// because pos_sales.business_id is not reliably populated.

// Sales by Month — ALL channels (online + b2b SOs + POS), GST exc, last 12 months.
async function calcSalesByMonthIMS(bizId: string): Promise<MonthRow[]> {
  const [soRows, posRows] = await Promise.all([
    imsQuery<any>(
      `SELECT DATE_FORMAT(so.order_date, '%Y-%m') AS month, SUM(so.subtotal) AS revenue
       FROM ims_sales_orders so
       WHERE so.business_id = ? AND so.status = 'fulfilled'
         AND so.order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY month`,
      [bizId],
    ),
    imsQuery<any>(
      `SELECT DATE_FORMAT(ps.completed_at, '%Y-%m') AS month, SUM(ps.total - ps.tax_total) AS revenue
       FROM pos_sales ps
       JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
       WHERE ps.status = 'completed' AND ps.sale_type = 'sale'
         AND ps.completed_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY month`,
      [bizId],
    ),
  ]);
  const map = new Map<string, number>();
  for (const r of [...soRows, ...posRows]) {
    const m = String(r.month ?? '');
    if (!m) continue;
    map.set(m, (map.get(m) ?? 0) + Number(r.revenue ?? 0));
  }
  return Array.from(map.entries()).map(([month, revenue]) => ({ month, revenue })).sort((a, b) => a.month.localeCompare(b.month));
}

// Online Sales by Month — Shopify (so_type='online') only, GST exc, last 12 months.
async function calcOnlineSalesByMonthIMS(bizId: string): Promise<MonthRow[]> {
  const rows = await imsQuery<any>(
    `SELECT DATE_FORMAT(so.order_date, '%Y-%m') AS month, SUM(so.subtotal) AS revenue
     FROM ims_sales_orders so
     WHERE so.business_id = ? AND so.so_type = 'online' AND so.status = 'fulfilled'
       AND so.order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
     GROUP BY month ORDER BY month`,
    [bizId],
  );
  return rows.map((r: any) => ({ month: String(r.month ?? ''), revenue: Number(r.revenue ?? 0) }));
}

// Online Top Brands — Shopify only, by brand, GST exc, last 12 months.
async function calcOnlineTopBrandsIMS(bizId: string, limit = 20): Promise<OnlineBrandRow[]> {
  const rows = await imsQuery<any>(
    `SELECT COALESCE(p.brand, '(Unknown)') AS brand,
            SUM(i.line_total)             AS revenue,
            SUM(i.qty_ordered)            AS qty,
            COUNT(DISTINCT so.id)         AS orders
     FROM ims_sales_orders so
     JOIN ims_sales_order_items i ON i.so_id = so.id
     LEFT JOIN ims_product_variants v1 ON v1.variant_id = i.variant_id
     LEFT JOIN ims_product_variants v2 ON v2.sku = i.code AND i.variant_id IS NULL
     LEFT JOIN ims_products p ON p.product_id = COALESCE(v1.product_id, v2.product_id)
     WHERE so.business_id = ? AND so.so_type = 'online' AND so.status = 'fulfilled'
       AND so.order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
     GROUP BY COALESCE(p.brand, '(Unknown)')
     ORDER BY revenue DESC
     LIMIT ?`,
    [bizId, limit],
  );
  return rows.map((r: any) => ({
    brand:   String(r.brand ?? '(Unknown)'),
    revenue: Number(r.revenue ?? 0),
    qty:     Math.round(Number(r.qty ?? 0)),
    orders:  Math.round(Number(r.orders ?? 0)),
  }));
}

// Revenue per Branch (IMS) — GST exc, last 90/180/365 days.
// Buckets: online SOs → 'Online'; b2b SOs & POS → physical location name.
async function calcRevByBranchIMS(bizId: string): Promise<BranchRow[]> {
  const [soRows, posRows] = await Promise.all([
    imsQuery<any>(
      `SELECT CASE WHEN so.so_type = 'online' THEN 'Online' ELSE COALESCE(l.name, 'Unknown') END AS branch,
              so.subtotal AS revenue,
              DATEDIFF(CURDATE(), so.order_date) AS age_days
       FROM ims_sales_orders so
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.business_id = ? AND so.status = 'fulfilled'
         AND so.order_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)`,
      [bizId],
    ),
    imsQuery<any>(
      `SELECT COALESCE(l.name, 'Unknown') AS branch,
              (ps.total - ps.tax_total) AS revenue,
              DATEDIFF(CURDATE(), DATE(ps.completed_at)) AS age_days
       FROM pos_sales ps
       JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
       WHERE ps.status = 'completed' AND ps.sale_type = 'sale'
         AND ps.completed_at >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)`,
      [bizId],
    ),
  ]);
  const rev: Record<string, BranchRow> = {};
  for (const r of [...soRows, ...posRows]) {
    const branch = String(r.branch ?? 'Unknown');
    const total = Number(r.revenue ?? 0);
    const age = Number(r.age_days ?? 999);
    if (!rev[branch]) rev[branch] = { branch, revenue90: 0, revenue180: 0, revenue365: 0 };
    rev[branch].revenue365 += total;
    if (age <= 180) rev[branch].revenue180 += total;
    if (age <= 90)  rev[branch].revenue90  += total;
  }
  return Object.values(rev).sort((a, b) => b.revenue365 - a.revenue365);
}

// getWebsiteSheetId removed � online reports now read from sales table (source = Shopify)

// -- Margin tier helpers -----------------------------------------------------

export type MarginThresholds = { high: number; mid: number };
export const DEFAULT_MARGIN_THRESHOLDS: MarginThresholds = { high: 65, mid: 40 };

async function readMarginThresholds(databaseId: string): Promise<MarginThresholds> {
  try {
    const all = await ConfigRepository.getAll(databaseId);
    const getVal = (key: string) => all[key] ?? null;
    const high = parseFloat(getVal('MarginTier_High') ?? '');
    const mid  = parseFloat(getVal('MarginTier_Mid')  ?? '');
    const h = Number.isFinite(high) && high > 0 && high <= 100 ? high : DEFAULT_MARGIN_THRESHOLDS.high;
    const m = Number.isFinite(mid)  && mid  > 0 && mid  <  h   ? mid  : DEFAULT_MARGIN_THRESHOLDS.mid;
    return { high: h, mid: m };
  } catch { return DEFAULT_MARGIN_THRESHOLDS; }
}

function getMarginTier(margin: number | null, t: MarginThresholds): string {
  if (margin == null) return 'no_data';
  if (margin >= t.high) return 'high';
  if (margin >= t.mid)  return 'mid';
  return 'low';
}

// -- Brand Summary aggregation ------------------------------------------------

type BrandRow = {
  brand: string; skuCount: number; totalQty: number; totalCost: number;
  sales90: number; sales180: number; sales365: number; avgMargin: number | null;
};

async function calcBrandSummary(inventorySystemId: string): Promise<BrandRow[]> {
  const products = await ProductsRepository.list(inventorySystemId);
  const map = new Map<string, { skus: Set<string>; qty: number; cost: number; r90: number; r180: number; r365: number; sumCostPriced: number; sumRrp: number }>();

  for (const p of products) {
    const brand = p.brand || '(No Brand)';
    const soh  = Number(p.global_soh       ?? 0);
    const cost = Number(p.cost             ?? 0);
    const rrp  = Number(p.retail_price     ?? 0);
    const r90  = Number(p.sales_revenue_90d  ?? 0);
    const r180 = Number(p.sales_revenue_180d ?? 0);
    const r12m = Number(p.sales_revenue_12m  ?? 0);

    if (!map.has(brand)) map.set(brand, { skus: new Set(), qty: 0, cost: 0, r90: 0, r180: 0, r365: 0, sumCostPriced: 0, sumRrp: 0 });
    const a = map.get(brand)!;
    if (p.code) a.skus.add(p.code);
    a.qty  += soh;
    a.cost += cost * soh;
    a.r90  += r90;
    a.r180 += r180;
    a.r365 += r12m;
    if (rrp > 0) { const rrpEx = rrp / 1.1; a.sumCostPriced += cost; a.sumRrp += rrpEx; }
  }

  return Array.from(map.entries())
    .map(([brand, a]) => ({
      brand, skuCount: a.skus.size, totalQty: Math.round(a.qty), totalCost: a.cost,
      sales90: a.r90, sales180: a.r180, sales365: a.r365,
      avgMargin: a.sumRrp > 0 ? (a.sumRrp - a.sumCostPriced) / a.sumRrp * 100 : null,
    }))
    .sort((a, b) => b.sales365 - a.sales365);
}

// -- Slowest Sellers aggregation -----------------------------------------------

type SlowSellerRow = { name: string; code: string; brand: string; soh: number; sales90: number; createdDate: string };

async function calcSlowSellers(inventorySystemId: string, limit = 20): Promise<SlowSellerRow[]> {
  const products = await ProductsRepository.list(inventorySystemId);
  const cutoff90 = Date.now() - 90 * 86_400_000;
  const results: SlowSellerRow[] = [];

  /** Normalise a DB date value (string | Date | null) to an ISO date string or '' */
  const toDateStr = (v: unknown): string => {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  for (const p of products) {
    const createdStr = toDateStr(p.created_date);
    if (createdStr) {
      const t = new Date(createdStr).getTime();
      if (isNaN(t) || t > cutoff90) continue;
    }
    const soh = Number(p.global_soh ?? 0);
    if (soh <= 2) continue;
    results.push({ name: p.name ?? '', code: p.code ?? '', brand: p.brand ?? '', soh, sales90: Number(p.sales_revenue_90d ?? 0), createdDate: createdStr.slice(0, 10) });
  }
  results.sort((a, b) => a.sales90 - b.sales90);
  return results.slice(0, limit);
}

// -- Revenue per Branch aggregation --------------------------------------------

type BranchRow = { branch: string; revenue90: number; revenue180: number; revenue365: number };

async function calcRevByBranch(inventorySystemId: string): Promise<BranchRow[]> {
  const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const sales = await SalesRepository.query(inventorySystemId, { from: oneYearAgo });
  const now = Date.now();
  const cut90 = now - 90 * 86400_000, cut180 = now - 180 * 86400_000, cut365 = now - 365 * 86400_000;

  const rev: Record<string, BranchRow> = {};
  for (const row of sales) {
    const dt = new Date(row.invoice_date).getTime();
    if (isNaN(dt) || dt < cut365) continue;
    const branch = row.branch_id ?? 'Unknown';
    const total = Number(row.line_total);
    if (!rev[branch]) rev[branch] = { branch, revenue90: 0, revenue180: 0, revenue365: 0 };
    rev[branch].revenue365 += total;
    if (dt >= cut180) rev[branch].revenue180 += total;
    if (dt >= cut90)  rev[branch].revenue90  += total;
  }
  return Object.values(rev).sort((a, b) => b.revenue365 - a.revenue365);
}

// -- Sales by Month aggregation -----------------------------------------------

type MonthRow = { month: string; revenue: number };

async function calcSalesByMonth(inventorySystemId: string): Promise<MonthRow[]> {
  const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const sales = await SalesRepository.query(inventorySystemId, { from: oneYearAgo });

  const map = new Map<string, number>();
  for (const row of sales) {
    const raw = row.invoice_date ?? '';
    if (!raw) continue;
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + Number(row.line_total));
  }
  return Array.from(map.entries()).map(([month, revenue]) => ({ month, revenue })).sort((a, b) => a.month.localeCompare(b.month));
}

// -- Yearly Revenue ------------------------------------------------------------

type YearlyRow = { branch: string; [year: string]: string };

async function readYearlyRevenue(inventorySystemId: string): Promise<YearlyRow[]> {
  const rows = await YearlyRevenueRepository.list(inventorySystemId);
  if (rows.length === 0) return [];
  const branches = new Map<string, YearlyRow>();
  for (const row of rows) {
    const branch = row.extra_json?.branch ?? 'Total';
    if (!branches.has(branch)) branches.set(branch, { branch });
    branches.get(branch)![String(row.year)] = String(Number(row.revenue).toFixed(2));
  }
  return Array.from(branches.values());
}

// -- Online Top Brands (from sales table filtered to Shopify source) ----------

type OnlineBrandRow = { brand: string; revenue: number; qty: number; orders: number };

async function calcOnlineTopBrands(inventorySystemId: string, limit = 20): Promise<OnlineBrandRow[]> {
  try {
    const rows = await mysqlQuery<any>(
      `SELECT
         COALESCE(p.brand, '(Unknown)')          AS brand,
         SUM(s.line_total)                       AS revenue,
         SUM(s.qty)                              AS qty,
         COUNT(DISTINCT s.order_id)              AS orders
       FROM sales s
       LEFT JOIN products p
         ON p.business_id = s.business_id AND p.option_id = s.product_option_id
       WHERE s.business_id = ?
         AND (
           LOWER(COALESCE(s.source, '')) LIKE '%shopify%'
           OR LOWER(COALESCE(s.source, '')) LIKE '%online%'
         )
         AND s.invoice_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY COALESCE(p.brand, '(Unknown)')
       ORDER BY revenue DESC
       LIMIT ?`,
      [inventorySystemId, limit],
    );
    return rows.map((r: any) => ({
      brand:   String(r.brand ?? '(Unknown)'),
      revenue: Number(r.revenue ?? 0),
      qty:     Math.round(Number(r.qty ?? 0)),
      orders:  Math.round(Number(r.orders ?? 0)),
    }));
  } catch { return []; }
}

// -- Online Performance (GA4) -------------------------------------------------

type OnlinePerformance = { conversionRate: number | null; totalSessions: number; totalConversions: number };

async function calcOnlinePerformance(databaseId: string): Promise<OnlinePerformance> {
  const result: OnlinePerformance = { conversionRate: null, totalSessions: 0, totalConversions: 0 };
  try {
    const ga4PropertyId = await ConfigRepository.get(databaseId, 'GA4PropertyId');
    if (ga4PropertyId) {
      const ga = new GoogleAnalyticsService(ga4PropertyId);
      const gaRows = await ga.runReport(['date'], ['sessions', 'conversions'], '90daysAgo', 'today').catch(() => [] as string[][]);
      if (gaRows && gaRows.length > 1) {
        const hi = gaRows[0]; const si = hi.indexOf('sessions'); const ci = hi.indexOf('conversions');
        for (const r of gaRows.slice(1)) { result.totalSessions += parseNum(r[si] ?? '0'); result.totalConversions += parseNum(r[ci] ?? '0'); }
        if (result.totalSessions > 0) result.conversionRate = (result.totalConversions / result.totalSessions) * 100;
      }
    }
  } catch {}
  return result;
}

// -- Online Sales by Month (from sales table filtered to Shopify source) -------

async function calcOnlineSalesByMonth(inventorySystemId: string): Promise<MonthRow[]> {
  try {
    const rows = await mysqlQuery<any>(
      `SELECT
         DATE_FORMAT(s.invoice_date, '%Y-%m') AS month,
         SUM(s.line_total)                    AS revenue
       FROM sales s
       WHERE s.business_id = ?
         AND (
           LOWER(COALESCE(s.source, '')) LIKE '%shopify%'
           OR LOWER(COALESCE(s.source, '')) LIKE '%online%'
         )
         AND s.invoice_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month
       ORDER BY month`,
      [inventorySystemId],
    );
    return rows.map((r: any) => ({ month: String(r.month ?? ''), revenue: Number(r.revenue ?? 0) }));
  } catch { return []; }
}

// -- Monthly Retention (from sales table filtered to Shopify source) -----------
// Definition: % of orders in a given month placed by customers who have
// previously placed at least one other Shopify order (lifetime repeat customers).

type MonthlyRetentionRow = { month: string; totalOrders: number; repeatOrders: number; retentionRate: number };

async function calcMonthlyRetention(inventorySystemId: string): Promise<MonthlyRetentionRow[]> {
  try {
    const rows = await mysqlQuery<any>(
      `WITH shopify_sales AS (
         SELECT
           member_id,
           order_id,
           DATE_FORMAT(invoice_date, '%Y-%m') AS month
         FROM sales
         WHERE business_id = ?
           AND (
             LOWER(COALESCE(source, '')) LIKE '%shopify%'
             OR LOWER(COALESCE(source, '')) LIKE '%online%'
           )
           AND member_id IS NOT NULL AND member_id <> ''
           AND invoice_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       ),
       customer_lifetime AS (
         SELECT member_id, COUNT(DISTINCT order_id) AS lifetime_orders
         FROM sales
         WHERE business_id = ?
           AND (
             LOWER(COALESCE(source, '')) LIKE '%shopify%'
             OR LOWER(COALESCE(source, '')) LIKE '%online%'
           )
           AND member_id IS NOT NULL AND member_id <> ''
         GROUP BY member_id
       )
       SELECT
         s.month,
         COUNT(DISTINCT s.order_id)                                             AS totalOrders,
         COUNT(DISTINCT CASE WHEN cl.lifetime_orders > 1 THEN s.order_id END)  AS repeatOrders
       FROM shopify_sales s
       LEFT JOIN customer_lifetime cl ON cl.member_id = s.member_id
       GROUP BY s.month
       ORDER BY s.month`,
      [inventorySystemId, inventorySystemId],
    );
    return rows.map((r: any) => ({
      month:        String(r.month ?? ''),
      totalOrders:  Math.round(Number(r.totalOrders ?? 0)),
      repeatOrders: Math.round(Number(r.repeatOrders ?? 0)),
      retentionRate: Number(r.totalOrders ?? 0) > 0
        ? (Number(r.repeatOrders ?? 0) / Number(r.totalOrders)) * 100
        : 0,
    }));
  } catch { return []; }
}

// -- POST: aggregate and save --------------------------------------------------

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required.' }, { status: 400 });

  try {
    const inventorySystemId = await resolveInventorySystemId(databaseId);
    const savedAt = new Date().toISOString();
    const thresholds = await readMarginThresholds(databaseId);

    // When the business uses the Solvantis IMS as its inventory source, sales-based
    // reports must read from the IMS database (live online + POS + b2b), not the
    // stale cached `sales` table. Product-based reports still use ProductsRepository.
    const useIms = (await getInventorySource(databaseId).catch(() => 'cin7')) === 'solvantis';

    const [brandRows, revRows, yearlyRows, slowRows, monthRows, onlineMonthRows, onlineTopBrandRows, onlinePerf, monthlyRetentionRows] = await Promise.all([
      calcBrandSummary(inventorySystemId),
      useIms ? calcRevByBranchIMS(databaseId)        : calcRevByBranch(inventorySystemId),
      readYearlyRevenue(inventorySystemId),
      calcSlowSellers(inventorySystemId, 100),
      useIms ? calcSalesByMonthIMS(databaseId)       : calcSalesByMonth(inventorySystemId),
      useIms ? calcOnlineSalesByMonthIMS(databaseId) : calcOnlineSalesByMonth(inventorySystemId),
      useIms ? calcOnlineTopBrandsIMS(databaseId, 20): calcOnlineTopBrands(inventorySystemId, 20),
      calcOnlinePerformance(databaseId),
      useIms ? Promise.resolve([] as MonthlyRetentionRow[]) : calcMonthlyRetention(inventorySystemId),
    ]);

    // Save each report type to MySQL
    const saves: Promise<void>[] = [];

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'brand-summary', {
      savedAt,
      headers: ['brand','skus','totalQty','totalCost','sales90d','sales180d','sales365d','avgMargin','breakEvenRoas','gp90d','marginTier'],
      rows: brandRows.map(b => {
        const tier = getMarginTier(b.avgMargin, thresholds);
        const ber  = b.avgMargin != null && b.avgMargin > 0 ? (100 / b.avgMargin) : null;
        const gp90 = b.avgMargin != null ? b.sales90 * (b.avgMargin / 100) : null;
        return [b.brand, b.skuCount, b.totalQty, b.totalCost.toFixed(2), b.sales90.toFixed(2),
          b.sales180.toFixed(2), b.sales365.toFixed(2),
          b.avgMargin != null ? b.avgMargin.toFixed(1) : '',
          ber != null ? ber.toFixed(2) : '',
          gp90 != null ? gp90.toFixed(2) : '', tier];
      }),
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'revenue-per-branch', {
      savedAt, headers: ['branch','revenue90d','revenue180d','revenue365d'],
      rows: revRows.map(r => [r.branch, r.revenue90.toFixed(2), r.revenue180.toFixed(2), r.revenue365.toFixed(2)]),
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'slow-sellers', {
      savedAt, headers: ['name','code','brand','soh','sales90d','createdDate'],
      rows: slowRows.map(s => [s.name, s.code, s.brand, s.soh, s.sales90.toFixed(2), s.createdDate]),
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'sales-by-month', {
      savedAt, headers: ['month','revenue'],
      rows: monthRows.map(m => [m.month, m.revenue.toFixed(2)]),
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'online-sales-by-month', {
      savedAt, headers: ['month','revenue'],
      rows: onlineMonthRows.map(m => [m.month, m.revenue.toFixed(2)]),
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'online-top-brands', {
      savedAt, headers: ['brand','revenue','qty','orders'],
      rows: onlineTopBrandRows.map(b => [b.brand, b.revenue.toFixed(2), b.qty, b.orders]),
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'online-performance', {
      savedAt, conversionRate: onlinePerf.conversionRate, totalSessions: onlinePerf.totalSessions, totalConversions: onlinePerf.totalConversions,
    }));

    saves.push(CalcReportsRepository.replaceReport(inventorySystemId, 'monthly-retention', {
      savedAt, headers: ['month','totalOrders','repeatOrders','retentionRate'],
      rows: monthlyRetentionRows.map(r => [r.month, r.totalOrders, r.repeatOrders, r.retentionRate.toFixed(4)]),
    }));

    await Promise.all(saves);

    return NextResponse.json({
      success: true, savedAt,
      brandRows: brandRows.length, revRows: revRows.length, yearlyRows: yearlyRows.length,
      slowRows: slowRows.length, monthRows: monthRows.length,
      onlineMonthRows: onlineMonthRows.length, onlineTopBrandRows: onlineTopBrandRows.length,
      onlinePerformance: onlinePerf, monthlyRetentionRows: monthlyRetentionRows.length,
    });
  } catch (err: any) {
    console.error('[calculated/reports POST]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// -- GET: read saved reports ? structured data + text -------------------------

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required.' }, { status: 400 });

  const _cr = JSON.parse(session.value);
  if (databaseId !== _cr.businessId) return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });

  try {
    const inventorySystemId = await resolveInventorySystemId(databaseId);

    const [brandReport, revReport, slowReport, monthReport, onlineMonthReport,
           onlineBrandReport, onlinePerfReport, retentionReport, yearlyRows] = await Promise.all([
      CalcReportsRepository.getReport(inventorySystemId, 'brand-summary'),
      CalcReportsRepository.getReport(inventorySystemId, 'revenue-per-branch'),
      CalcReportsRepository.getReport(inventorySystemId, 'slow-sellers'),
      CalcReportsRepository.getReport(inventorySystemId, 'sales-by-month'),
      CalcReportsRepository.getReport(inventorySystemId, 'online-sales-by-month'),
      CalcReportsRepository.getReport(inventorySystemId, 'online-top-brands'),
      CalcReportsRepository.getReport(inventorySystemId, 'online-performance'),
      CalcReportsRepository.getReport(inventorySystemId, 'monthly-retention'),
      readYearlyRevenue(inventorySystemId),
    ]);

    const savedAt = brandReport?.savedAt ?? revReport?.savedAt ?? null;

    // Build text summary
    const lines: string[] = ['=== CALCULATED DATA REPORTS ==='];
    lines.push(`Report generated: ${savedAt ? String(savedAt).slice(0, 10) : 'N/A'}`);

    if (brandReport?.rows?.length) {
      lines.push('', '--- Brand Summary ---');
      lines.push('Brand | SKUs | Qty | Total Cost | Sales 90d | Sales 180d | Sales 365d | Avg Margin | ROAS | GP 90d | Tier');
      for (const r of brandReport.rows) {
        const [brand, skus, qty, cost, s90, s180, s365, margin, roas, gp90, tier] = r;
        lines.push(`${brand} | ${skus} | ${qty} | $${parseNum(cost).toLocaleString('en-AU',{minimumFractionDigits:2})} | $${parseNum(s90).toLocaleString('en-AU',{minimumFractionDigits:2})} | $${parseNum(s180).toLocaleString('en-AU',{minimumFractionDigits:2})} | $${parseNum(s365).toLocaleString('en-AU',{minimumFractionDigits:2})} | ${margin?parseFloat(String(margin)).toFixed(1)+'%':'N/A'} | ${roas?parseFloat(String(roas)).toFixed(2)+'x':'N/A'} | ${gp90?'$'+parseNum(gp90).toLocaleString('en-AU',{minimumFractionDigits:2}):'N/A'} | ${tier??'N/A'}`);
      }
    }
    if (revReport?.rows?.length) {
      lines.push('', '--- Revenue by Branch ---');
      lines.push('Branch | 90d | 180d | 365d');
      for (const r of revReport.rows) lines.push(`${r[0]} | $${parseNum(r[1]).toLocaleString('en-AU',{minimumFractionDigits:2})} | $${parseNum(r[2]).toLocaleString('en-AU',{minimumFractionDigits:2})} | $${parseNum(r[3]).toLocaleString('en-AU',{minimumFractionDigits:2})}`);
    }
    if (yearlyRows.length > 0) {
      lines.push('', '--- Yearly Revenue by Branch ---');
      const yearKeys = Object.keys(yearlyRows[0]).filter(k => k !== 'branch');
      lines.push(`Branch | ${yearKeys.join(' | ')}`);
      for (const r of yearlyRows) lines.push(`${r.branch} | ${yearKeys.map(y => r[y] || '�').join(' | ')}`);
    }
    if (slowReport?.rows?.length) {
      lines.push('', '--- Slowest Sellers ---');
      lines.push('Name | Code | Brand | SOH | Sales 90d | Created');
      for (const r of slowReport.rows) lines.push(`${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | $${parseNum(r[4]).toLocaleString('en-AU',{minimumFractionDigits:2})} | ${r[5]}`);
    }
    if (monthReport?.rows?.length) {
      lines.push('', '--- Sales by Month ---');
      for (const r of monthReport.rows) lines.push(`${r[0]} | $${parseNum(r[1]).toLocaleString('en-AU',{minimumFractionDigits:2})}`);
    }
    if (onlinePerfReport?.conversionRate != null) {
      lines.push('', '--- Online Performance ---');
      lines.push(`Conversion Rate (90d): ${parseFloat(String(onlinePerfReport.conversionRate)).toFixed(2)}% (${Math.round(Number(onlinePerfReport.totalConversions))} conversions from ${Number(onlinePerfReport.totalSessions).toLocaleString()} sessions)`);
    }
    if (lines.length <= 2) lines.push('No report data saved yet. Run the Calculated Data sync to generate reports.');

    // Structured data for dashboard
    const brands = (brandReport?.rows ?? []).map((r: any[]) => ({
      name: r[0] ?? '', skuCount: parseNum(r[1]), totalQty: parseNum(r[2]),
      totalCost: parseNum(r[3]), sales90: parseNum(r[4]), sales180: parseNum(r[5]), sales365: parseNum(r[6]),
      avgMargin: r[7] ? parseFloat(String(r[7])) : null,
    }));
    const brandTotals = brands.length ? brands.reduce((acc: any, b: any) => ({
      skuCount: acc.skuCount + b.skuCount, totalQty: acc.totalQty + b.totalQty, totalCost: acc.totalCost + b.totalCost,
      sales90: acc.sales90 + b.sales90, sales180: acc.sales180 + b.sales180, sales365: acc.sales365 + b.sales365,
    }), { skuCount: 0, totalQty: 0, totalCost: 0, sales90: 0, sales180: 0, sales365: 0 }) : null;

    const branches = (revReport?.rows ?? []).map((r: any[]) => ({
      name: r[0] ?? '', revenue90: parseNum(r[1]), revenue180: parseNum(r[2]), revenue365: parseNum(r[3]),
    }));
    const revTotals = branches.length ? branches.reduce((acc: any, b: any) => ({
      revenue90: acc.revenue90 + b.revenue90, revenue180: acc.revenue180 + b.revenue180, revenue365: acc.revenue365 + b.revenue365,
    }), { revenue90: 0, revenue180: 0, revenue365: 0 }) : null;

    const slowSellers = (slowReport?.rows ?? []).map((r: any[]) => ({
      name: r[0] ?? '', code: r[1] ?? '', brand: r[2] ?? '', soh: parseNum(r[3]), sales90: parseNum(r[4]), createdDate: r[5] ?? '',
    }));

    const salesByMonth = (monthReport?.rows ?? []).map((r: any[]) => ({ month: r[0] ?? '', revenue: parseNum(r[1]) }));

    const onlineSalesByMonthBase = (onlineMonthReport?.rows ?? []).map((r: any[]) => ({ month: r[0] ?? '', revenue: parseNum(r[1]) }));
    const onlineRevByMonth = new Map(onlineSalesByMonthBase.map((r: any) => [r.month, r.revenue]));
    const onlineSalesByMonth = onlineSalesByMonthBase.map((r: any) => {
      const [yr, mo] = r.month.split('-');
      const prevKey = `${Number(yr) - 1}-${mo}`;
      const yoyRevenue = (onlineRevByMonth.get(prevKey) as number | undefined) ?? null;
      const yoyChange = yoyRevenue != null && yoyRevenue > 0 ? ((r.revenue - yoyRevenue) / yoyRevenue) * 100 : null;
      return { ...r, yoyRevenue, yoyChange };
    });

    const onlineTopBrands = (onlineBrandReport?.rows ?? []).map((r: any[]) => ({
      brand: r[0] ?? '', revenue: parseNum(r[1]), qty: parseNum(r[2]), orders: parseNum(r[3]),
    }));

    const onlinePerformance = onlinePerfReport ? {
      conversionRate: onlinePerfReport.conversionRate,
      totalSessions: Number(onlinePerfReport.totalSessions),
      totalConversions: Number(onlinePerfReport.totalConversions),
    } : null;

    const monthlyRetentionBase = (retentionReport?.rows ?? []).map((r: any[]) => ({
      month: r[0] ?? '', totalOrders: parseInt(String(r[1] || '0'), 10), repeatOrders: parseInt(String(r[2] || '0'), 10), retentionRate: parseFloat(String(r[3] || '0')),
    }));
    const retRateByMonth = new Map(monthlyRetentionBase.map((r: any) => [r.month, r.retentionRate]));
    const monthlyRetention = monthlyRetentionBase.map((r: any) => {
      const [yr, mo] = r.month.split('-');
      const yoyRetentionRate = retRateByMonth.get(`${Number(yr) - 1}-${mo}`) ?? null;
      return { ...r, yoyRetentionRate };
    });

    return NextResponse.json({
      success: true, text: lines.join('\n'), savedAt,
      brands, brandTotals, branches, revTotals, slowSellers, salesByMonth,
      onlineSalesByMonth, onlineTopBrands, onlinePerformance, monthlyRetention,
    });
  } catch (err: any) {
    console.error('[calculated/reports GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
