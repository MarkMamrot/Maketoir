import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCin7Credentials, resolveInventorySystemId, cin7Fetch, sleep } from '@/lib/cin7Helpers';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { BranchesRepository } from '@/lib/db/BranchesAndSuppliersRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const CIN7_BASE = 'https://api.cin7.com/api/v1';
const PAGE_SIZE = 250;
const REQUEST_DELAY_MS = 1100;
const WRITE_BATCH_SIZE = 500;

// One row per order line item — the branchId on the ORDER is used as the

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Streams pages from Cin7, calling onBatch for each page. Returns total order count. */
async function streamPages(
  authHeader: string,
  path: string,
  extraParams: Record<string, string>,
  onBatch: (orders: any[]) => Promise<boolean | void>,
  signal?: AbortSignal,
): Promise<number> {
  let page = 1;
  let total = 0;
  while (true) {
    if (signal?.aborted) { console.log(`[cin7/sales] Client disconnected — stopping at page ${page}`); break; }

    const url = new URL(`${CIN7_BASE}${path}`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);

    console.log(`[cin7/sales] GET ${path} page ${page}`);
    const data = await cin7Fetch(url.toString(), authHeader, 0, 'cin7/sales');
    const records: any[] = Array.isArray(data) ? data : [];

    if (records.length === 0) break;
    const stop = await onBatch(records);
    total += records.length;
    if (stop === true) { console.log(`[cin7/sales] Early termination after page ${page}`); break; }
    if (records.length < PAGE_SIZE) break;

    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return total;
}

/**
 * Flattens one SalesOrder into one SaleRow per lineItem.
 * branchId from the order header is used as the fulfillment branch.
 * lineTotal is resolved ex-tax (Cin7 stores incl. tax when taxStatus = 'Incl').
 */
function flattenOrder(order: any): Array<Omit<import('@/lib/db/SalesRepository').SaleRow, 'id' | 'business_id'>> {
  const asNumber = (v: any): number | null => {
    const n = Number.parseFloat(String(v ?? '').trim());
    return Number.isFinite(n) ? n : null;
  };

  const resolveLineTotal = (qty: number, unitPrice: number, line: any): number => {
    const gross = qty * unitPrice;
    const explicit = [line?.lineTotal, line?.total, line?.netTotal, line?.subTotal, line?.subtotal]
      .map(asNumber).find((v): v is number => v != null);
    if (explicit != null) return explicit;
    const discountRaw = asNumber(line?.discount) ?? 0;
    const discountType = String(line?.discountType ?? line?.discountKind ?? '').toLowerCase();
    if (discountType.includes('%') || discountType.includes('percent')) return gross * (1 - discountRaw / 100);
    return gross - discountRaw;
  };

  const lines: any[] = Array.isArray(order.lineItems) ? order.lineItems : [];
  const orderTaxRate = Number(order.taxRate) || 0;
  const taxInclusive = String(order.taxStatus ?? '').toLowerCase().startsWith('incl');
  const exTaxFactor = (taxInclusive && orderTaxRate > 0) ? (1 / (1 + orderTaxRate)) : 1;
  const orderDate = (order.invoiceDate ?? order.createdDate ?? '').slice(0, 10) || '1970-01-01';

  return lines.map(line => {
    const qty = parseFloat(line.qty) || 0;
    const price = parseFloat(line.unitPrice) || 0;
    const lineTotalGross = resolveLineTotal(qty, price, line);
    const lineTaxRate = Number(line.taxRate) > 0 ? Number(line.taxRate) : orderTaxRate;
    const lineExTaxFactor = (taxInclusive && lineTaxRate > 0) ? (1 / (1 + lineTaxRate)) : exTaxFactor;
    const lineTotal = lineTotalGross * lineExTaxFactor;

    return {
      order_id:          String(order.id ?? ''),
      reference:         order.reference ?? null,
      invoice_date:      orderDate,
      branch_id:         String(order.branchId ?? '') || null,
      member_id:         order.memberId ? String(order.memberId) : null,
      product_option_id: String(line.productOptionId ?? ''),
      code:              line.code ?? null,
      name:              line.name ?? null,
      qty,
      unit_price:        price,
      line_total:        parseFloat(lineTotal.toFixed(4)),
      source:            order.source ?? null,
      status:            order.status ?? null,
      stage:             order.stage ?? null,
    };
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId, fullSync = false, activeBranchesOnly = true } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  let creds;
  try { creds = await getCin7Credentials(databaseId); }
  catch (e: any) { return NextResponse.json({ success: false, error: e.message }, { status: 400 }); }

  const inventorySystemId = await resolveInventorySystemId(databaseId);
  const syncedAt = new Date().toISOString();

  // Build set of active branch IDs from MySQL
  let activeBranchIds: Set<string> | null = null;
  if (activeBranchesOnly) {
    try {
      const branches = await BranchesRepository.list(inventorySystemId);
      if (branches.length > 0) {
        activeBranchIds = new Set(
          branches
            .filter(b => b.is_active)
            .map(b => String(b.cin7_id ?? b.name))
        );
        console.log(`[cin7/sales] Active branch IDs: ${[...activeBranchIds].join(', ')}`);
      }
    } catch (e: any) {
      console.warn(`[cin7/sales] Branch filter failed: ${e.message}`);
    }
  }

  const lastSync = fullSync ? null : await ConfigRepository.get(databaseId, 'LastSalesSync');
  const mode = lastSync ? `incremental since ${lastSync}` : 'full';
  console.log(`[cin7/sales] Starting ${mode} sync`);

  const cut12m = Date.now() - 365 * 86400_000;
  let totalOrders = 0;
  let totalLines = 0;
  let rowBuffer: Array<Omit<import('@/lib/db/SalesRepository').SaleRow, 'id' | 'business_id'>> = [];

  const flushBuffer = async () => {
    if (rowBuffer.length === 0) return;
    await SalesRepository.appendBatch(inventorySystemId, rowBuffer);
    console.log(`[cin7/sales] Persisted ${rowBuffer.length} rows (running total: ${totalLines})`);
    await ConfigRepository.set(databaseId, 'LastSalesSync', syncedAt);
    rowBuffer = [];
  };

  try {
    const params: Record<string, string> = {};
    params.modifiedDate = lastSync ?? new Date(cut12m).toISOString();

    totalOrders = await streamPages(creds.authHeader, '/SalesOrders', params, async (orders) => {
      const filtered = orders.filter(o => {
        if (o.isVoid === true || o.isVoid === 'true' || o.isVoid === 1) return false;
        const stage = String(o.stage ?? '').toLowerCase();
        if (stage === 'void' || stage === 'cancelled' || stage === 'canceled') return false;
        if (activeBranchIds && !activeBranchIds.has(String(o.branchId))) return false;
        const t = new Date(o.invoiceDate ?? o.createdDate ?? '').getTime();
        return !isNaN(t) && t >= cut12m;
      });
      const rows = filtered.flatMap(o => flattenOrder(o));
      rowBuffer.push(...rows);
      totalLines += rows.length;
      if (rowBuffer.length >= WRITE_BATCH_SIZE) await flushBuffer();
    }, req.signal);
    await flushBuffer();
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: `Sync failed after ${totalOrders} orders / ${totalLines} lines: ${e.message}`,
    }, { status: 500 });
  }

  await ConfigRepository.set(databaseId, 'LastSalesSync', syncedAt);

  return NextResponse.json({
    success: true,
    synced: totalOrders,
    lines: totalLines,
    mode,
    message: totalOrders === 0
      ? 'No new or updated orders.'
      : `${lastSync ? 'Incremental' : 'Full'} sync complete — ${totalLines} lines from ${totalOrders} orders.`,
  });
}

// ── GET: return last sync timestamp ──────────────────────────────────────────

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const _ug = JSON.parse(session.value);
  if (!databaseId || databaseId !== _ug.userSpreadsheetId) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const lastSalesSync = await ConfigRepository.get(databaseId, 'LastSalesSync');
    return NextResponse.json({ success: true, lastSalesSync });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}



