import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';

// ── Constants ─────────────────────────────────────────────────────────────────

const CIN7_BASE = 'https://api.cin7.com/api/v1';
const PAGE_SIZE = 250;
const REQUEST_DELAY_MS = 1100;
const MAX_RETRIES = 3;
const WRITE_BATCH_SIZE = 2000;

const SHEET = 'PurchaseOrders';
const MONTHS_BACK = 24;

// One row per line item for analytical usefulness
const HEADERS = [
  'orderId', 'reference', 'invoiceDate', 'createdDate', 'fullyReceivedDate',
  'supplierId', 'supplierName', 'branchId', 'status', 'stage',
  'productId', 'productOptionId', 'code', 'name',
  'qty', 'unitPrice', 'lineTotal', 'lastSyncedAt',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function cin7Fetch(url: string, authHeader: string, retryCount = 0): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    if (retryCount >= MAX_RETRIES) throw new Error(`Cin7 network error: ${e.message}`);
    await sleep(Math.pow(2, retryCount) * 3000);
    return cin7Fetch(url, authHeader, retryCount + 1);
  }

  if (res.status === 429) {
    if (retryCount >= MAX_RETRIES) throw new Error('Cin7 rate limit exceeded after retries.');
    console.log('[cin7/po] 429 — waiting 60s...');
    await sleep(60_000);
    return cin7Fetch(url, authHeader, retryCount + 1);
  }
  if (res.status >= 500) {
    if (retryCount >= MAX_RETRIES) throw new Error(`Cin7 server error: HTTP ${res.status}`);
    await sleep(Math.pow(2, retryCount) * 2000);
    return cin7Fetch(url, authHeader, retryCount + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cin7 error HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Streams all pages of PurchaseOrders, calling onBatch per page.
 * Uses a createdDate >= filter to limit to the last 24 months.
 */
async function streamPages(
  authHeader: string,
  cutoffDate: string,
  onBatch: (orders: any[]) => Promise<void>,
): Promise<number> {
  let page = 1;
  let total = 0;

  while (true) {
    const url = new URL(`${CIN7_BASE}/PurchaseOrders`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    // Filter server-side where supported — createdDate in ISO format
    url.searchParams.set('where', `createdDate>='${cutoffDate}'`);

    console.log(`[cin7/po] GET /PurchaseOrders page ${page}`);
    const data = await cin7Fetch(url.toString(), authHeader);
    const records: any[] = Array.isArray(data) ? data : [];

    if (records.length === 0) break;
    await onBatch(records);
    total += records.length;
    if (records.length < PAGE_SIZE) break;

    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  return total;
}

function mapOrderRows(order: any, syncedAt: string): string[][] {
  const str = (v: any) => (v != null ? String(v) : '');
  const lines: any[] = Array.isArray(order.lineItems) ? order.lineItems : [];

  // Supplier name: prefer company, fall back to first+last name
  const supplierName = order.company
    ? order.company
    : [order.firstName, order.lastName].filter(Boolean).join(' ');

  const orderBase = [
    str(order.id),
    order.reference        ?? '',
    order.invoiceDate      ?? '',
    order.createdDate      ?? '',
    order.fullyReceivedDate ?? '',
    str(order.memberId),
    supplierName,
    str(order.branchId),
    order.status           ?? '',
    order.stage            ?? '',
  ];

  // If order has no line items, emit one summary row
  if (lines.length === 0) {
    return [[...orderBase, '', '', '', '', '', '', '', syncedAt]];
  }

  return lines.map(line => {
    const qty       = parseFloat(line.qty) || 0;
    const unitPrice = parseFloat(line.unitPrice) || 0;
    const discount  = parseFloat(line.discount) || 0;
    const lineTotal = (qty * unitPrice * (1 - discount / 100)).toFixed(2);
    return [
      ...orderBase,
      str(line.productId),
      str(line.productOptionId),
      line.code ?? '',
      line.name ?? '',
      str(qty),
      str(unitPrice),
      lineTotal,
      syncedAt,
    ];
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/sync/purchase-orders
 * Body: { databaseId: string }
 *
 * Fetches Cin7 Purchase Orders created in the last 24 months,
 * expands line items, and writes to the PurchaseOrders sheet.
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId } = await req.json();
  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  const sheets = new GoogleSheetsService();

  // 1. Load credentials
  let accountId = '';
  let apiKey = '';
  let inventorySystemId = databaseId;
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    if (!conn?.cin7_account_id) {
      return NextResponse.json({ success: false, error: 'No Cin7 credentials saved for this business.' }, { status: 400 });
    }
    accountId = conn.cin7_account_id;
    apiKey = conn.cin7_api_key ? decrypt(conn.cin7_api_key) : '';
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load credentials: ${e.message}` }, { status: 500 });
  }

  // Resolve Inventory System spreadsheet ID from MySQL config
  try {
    inventorySystemId = await resolveInventorySystemId(databaseId);
  } catch { /* fall back to databaseId */ }

  if (!accountId || !apiKey) {
    return NextResponse.json({ success: false, error: 'Cin7 credentials not configured. Save them in Setup → Connections first.' }, { status: 400 });
  }

  const authHeader = `Basic ${Buffer.from(`${accountId}:${apiKey}`).toString('base64')}`;
  const syncedAt = new Date().toISOString();

  // Cutoff date: 24 months ago
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffDate = cutoff.toISOString().replace(/\.\d{3}Z$/, 'Z'); // yyyy-MM-ddTHH:mm:ssZ
  console.log(`[cin7/po] Fetching purchase orders since ${cutoffDate}`);

  // 2. Initialise sheet with headers, then stream rows in batches
  let totalOrders = 0;
  let totalRows = 0;
  let sheetReady = false;

  try {
    let pendingRows: string[][] = [];

    const flush = async (force = false) => {
      if (pendingRows.length === 0) return;
      if (!force && pendingRows.length < WRITE_BATCH_SIZE) return;
      if (!sheetReady) {
        await sheets.resetSheet(inventorySystemId, SHEET, HEADERS);
        sheetReady = true;
      }
      await sheets.appendData(inventorySystemId, `${SHEET}!A1`, pendingRows);
      totalRows += pendingRows.length;
      pendingRows = [];
    };

    totalOrders = await streamPages(authHeader, cutoffDate, async (orders) => {
      for (const order of orders) {
        pendingRows.push(...mapOrderRows(order, syncedAt));
      }
      await flush();
    });

    await flush(true);

    // If no orders at all, still reset the sheet so headers are present
    if (!sheetReady) {
      await sheets.resetSheet(inventorySystemId, SHEET, HEADERS);
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Sync failed: ${e.message}` }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    synced: totalRows,
    orders: totalOrders,
    message: `Synced ${totalRows} line item${totalRows !== 1 ? 's' : ''} from ${totalOrders} purchase order${totalOrders !== 1 ? 's' : ''} (last ${MONTHS_BACK} months).`,
  });
}
