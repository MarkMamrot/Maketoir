/**
 * XeroSyncService — builds and posts Xero accounting documents from IMS data.
 *
 * Sync rules (agreed architecture):
 * ─────────────────────────────────────────────────────────────────────────────
 * PO → Bill:
 *   • PO created → Draft Bill in Xero
 *   • Payment recorded on PO → Approve Bill (code to "Inventory in Transit"), record Payment
 *   • PO received (no deposits) → Approve Bill (code to "Inventory Asset" directly)
 *   • PO received (with prior deposits) → Journal: DR Inventory Asset, CR Inventory in Transit
 *
 * SO (wholesale) → Individual Xero Invoice
 * POS daily batch → One summary invoice per location per day
 * Online/Shopify daily → One summary invoice per day
 * Monthly COGS → Journal: DR COGS, CR Inventory Asset
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { xeroApiFetch } from '@/services/XeroService';
import { query, execute } from '@/services/MySQLService';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface AccountMapping {
  inventory_asset?: string;
  inventory_in_transit?: string;
  cogs?: string;
  sales_revenue?: string;
  freight?: string;
  stock_adjustment?: string;
  credit_note?: string;
}

interface TrackingMapping {
  ims_location_id: number | null;
  ims_channel: string | null;
  xero_tracking_category_id: string;
  xero_tracking_option_id: string;
}

export async function getAccountMappings(businessId: string): Promise<AccountMapping> {
  const rows = await query<{ role_key: string; xero_account_code: string }>(
    'SELECT role_key, xero_account_code FROM xero_account_mappings WHERE business_id = ?',
    [businessId],
  );
  const map: any = {};
  for (const r of rows) map[r.role_key] = r.xero_account_code;
  return map;
}

export async function getTrackingMappings(businessId: string): Promise<TrackingMapping[]> {
  return query<TrackingMapping>(
    'SELECT ims_location_id, ims_channel, xero_tracking_category_id, xero_tracking_option_id FROM xero_tracking_mappings WHERE business_id = ?',
    [businessId],
  );
}

/** Returns 'capitalise' if freight should be absorbed into stock value, else 'expense' (default). */
async function getFreightTreatment(businessId: string): Promise<'expense' | 'capitalise'> {
  try {
    const rows = await imsQuery<{ value: string }>(
      "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'freight_treatment' LIMIT 1",
      [businessId],
    );
    return rows[0]?.value === 'capitalise' ? 'capitalise' : 'expense';
  } catch {
    return 'expense';
  }
}

/** Standard Xero TaxType codes — hardcoded to the universal defaults (OUTPUT / INPUT / NONE). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getTaxTypes(_businessId: string): { sales: string; purchases: string; exempt: string } {
  return { sales: 'OUTPUT', purchases: 'INPUT', exempt: 'NONE' };
}

function getTrackingForLocation(mappings: TrackingMapping[], locationId: number | null, channel?: string) {
  const result: { TrackingCategoryID: string; TrackingOptionID: string }[] = [];
  const usedCategories = new Set<string>();

  // Location mapping — only match rows where ims_channel is null
  if (locationId) {
    const m = mappings.find(t => t.ims_location_id === locationId && t.ims_channel == null);
    if (m) {
      result.push({ TrackingCategoryID: m.xero_tracking_category_id, TrackingOptionID: m.xero_tracking_option_id });
      usedCategories.add(m.xero_tracking_category_id);
    }
  }

  // Channel mapping — only add if it belongs to a different Tracking Category (Xero max = 2)
  if (channel) {
    const m = mappings.find(t => t.ims_channel === channel);
    if (m && !usedCategories.has(m.xero_tracking_category_id)) {
      result.push({ TrackingCategoryID: m.xero_tracking_category_id, TrackingOptionID: m.xero_tracking_option_id });
    }
  }

  return result.length > 0 ? result : undefined;
}

/** Ensures the xero_sync_log table exists — called lazily before first insert. */
let _syncLogTableReady = false;
async function ensureSyncLogTable(): Promise<void> {
  if (_syncLogTableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS xero_sync_log (
      id           BIGINT       AUTO_INCREMENT PRIMARY KEY,
      business_id  VARCHAR(255) NOT NULL,
      sync_type    VARCHAR(30)  NOT NULL,
      reference_id INT          DEFAULT NULL,
      xero_id      VARCHAR(100) DEFAULT NULL,
      status       VARCHAR(20)  NOT NULL DEFAULT 'success',
      xero_state   VARCHAR(20)  DEFAULT NULL,
      detail       TEXT         DEFAULT NULL,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_business_type    (business_id, sync_type),
      INDEX idx_business_created (business_id, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, []);
  // Add xero_state to existing tables that pre-date this column.
  try {
    const existing = await query(`SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'`, []);
    if (!existing.length) {
      await execute(`ALTER TABLE xero_sync_log ADD COLUMN xero_state VARCHAR(20) DEFAULT NULL AFTER status`, []);
    }
  } catch { /* column already exists or table not yet created — safe to ignore */ }
  _syncLogTableReady = true;
}

async function logSync(
  businessId: string,
  syncType: string,
  referenceId: number | null,
  xeroId: string | null,
  status: 'success' | 'error' | 'skipped',
  detail?: string,
  xeroState?: string | null,
) {
  try {
    await ensureSyncLogTable();
    await execute(
      `INSERT INTO xero_sync_log (business_id, sync_type, reference_id, xero_id, status, xero_state, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessId, syncType, referenceId, xeroId, status, xeroState ?? null, detail ?? null],
    );
  } catch (err: any) {
    // Logging must never break a sync — swallow and warn instead
    console.warn('[XeroSyncService] logSync failed (sync still proceeded):', err?.message ?? err);
  }
}

/** Write Xero sync status back to the PO row. Silent — never throws.
 * xeroId === undefined → don't touch xero_bill_id
 * xeroId === null     → explicitly clear xero_bill_id to NULL (e.g. after void)
 * xeroId === string   → set xero_bill_id to that value
 */
export async function markPoXeroStatus(
  poId: number,
  status: 'synced' | 'queued' | 'error',
  xeroId?: string | null,
): Promise<void> {
  try {
    await imsExecute(
      `UPDATE ims_purchase_orders
         SET xero_sync_status = ?, xero_synced_at = NOW()
             ${xeroId !== undefined ? ', xero_bill_id = ?' : ''}
         WHERE id = ?`,
      xeroId !== undefined ? [status, xeroId, poId] : [status, poId],
    );
  } catch { /* non-critical */ }
}

/** Write Xero sync status back to the stocktake row. Silent — never throws. */
export async function markStocktakeXeroStatus(
  stocktakeId: number,
  status: 'synced' | 'queued' | 'error',
  xeroId?: string | null,
): Promise<void> {
  try {
    await imsExecute(
      `UPDATE ims_stocktakes
         SET xero_sync_status = ?, xero_synced_at = NOW()
             ${xeroId != null ? ', xero_journal_id = ?' : ''}
         WHERE id = ?`,
      xeroId != null ? [status, xeroId, stocktakeId] : [status, stocktakeId],
    );
  } catch { /* non-critical */ }
}

// ─── Stocktake → Xero Manual Journal ─────────────────────────────────────────

/**
 * Post a Xero Manual Journal for all non-zero variances in a completed stocktake.
 * For each variant where counted_qty ≠ expected_qty:
 *   Shrinkage (missing stock): DR Stock Adjustment expense / CR Inventory Asset
 *   Surplus  (extra stock):    DR Inventory Asset / CR Stock Adjustment expense
 * Valued at avg_cost from ims_stock at the stocktake location.
 */
export async function syncStocktakeJournal(
  businessId: string,
  stocktakeId: number,
): Promise<{ journalId: string | null; lines: number; totalValue: number }> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);

  if (!accounts.inventory_asset || !accounts.stock_adjustment) {
    await logSync(businessId, 'stocktake_journal', stocktakeId, null, 'skipped',
      'Missing inventory_asset or stock_adjustment account mapping');
    await markStocktakeXeroStatus(stocktakeId, 'error');
    throw new Error('Missing Xero account mappings: inventory_asset and stock_adjustment are required');
  }

  // Fetch stocktake header + items with avg_cost joined from ims_stock
  const [stRows] = await Promise.all([
    imsQuery<{ id: number; reference: string; location_id: number; completed_at: string | null; status: string }>(
      `SELECT id, reference, location_id, completed_at, status FROM ims_stocktakes WHERE id = ?`,
      [stocktakeId],
    ),
  ]);
  const st = stRows[0];
  if (!st) throw new Error('Stocktake not found');
  if (st.status !== 'completed') throw new Error('Stocktake must be completed before syncing to Xero');

  const items = await imsQuery<{
    variant_id: string; sku: string | null; product_name: string;
    expected_qty: string; counted_qty: string | null; avg_cost: string | null;
  }>(
    `SELECT si.variant_id,
            pv.sku,
            p.name AS product_name,
            si.expected_qty,
            si.counted_qty,
            sk.avg_cost
       FROM ims_stocktake_items si
       LEFT JOIN ims_product_variants pv ON pv.id = si.variant_id
       LEFT JOIN ims_products p ON p.id = pv.product_id
       LEFT JOIN ims_stock sk ON sk.variant_id = si.variant_id AND sk.location_id = ?
      WHERE si.stocktake_id = ?
        AND si.counted_qty IS NOT NULL`,
    [st.location_id, stocktakeId],
  );

  const tracking = getTrackingForLocation(trackingMappings, st.location_id);
  const journalDate = st.completed_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  const journalLines: any[] = [];
  let totalValue = 0;

  for (const item of items) {
    const expected = Number(item.expected_qty);
    const counted  = Number(item.counted_qty);
    const variance = counted - expected;
    if (Math.abs(variance) < 0.00001) continue; // zero variance — skip

    const avgCost     = Number(item.avg_cost ?? 0);
    const absValue    = Math.abs(variance * avgCost);
    totalValue       += absValue;
    const description = `${item.sku || item.variant_id} — ${item.product_name || 'Unknown'} (exp ${expected}, counted ${counted})`;

    if (variance < 0) {
      // Stock MISSING → DR Stock Adjustment expense / CR Inventory Asset
      journalLines.push({ LineAmount: absValue, AccountCode: accounts.stock_adjustment, Description: description, Tracking: tracking });
      journalLines.push({ LineAmount: -absValue, AccountCode: accounts.inventory_asset,  Description: description, Tracking: tracking });
    } else {
      // Stock SURPLUS → DR Inventory Asset / CR Stock Adjustment expense
      journalLines.push({ LineAmount: absValue, AccountCode: accounts.inventory_asset,  Description: description, Tracking: tracking });
      journalLines.push({ LineAmount: -absValue, AccountCode: accounts.stock_adjustment, Description: description, Tracking: tracking });
    }
  }

  if (journalLines.length === 0) {
    await logSync(businessId, 'stocktake_journal', stocktakeId, null, 'skipped', 'No non-zero variances to post');
    await markStocktakeXeroStatus(stocktakeId, 'synced', null);
    return { journalId: null, lines: 0, totalValue: 0 };
  }

  const journal = {
    Narration: `Stocktake ${st.reference} — Stock Adjustment — ${journalDate}`,
    Date: journalDate,
    JournalLines: journalLines,
  };

  try {
    const result = await xeroApiFetch(businessId, '/ManualJournals', {
      method: 'POST',
      body: { ManualJournals: [journal] },
    });
    const journalId = result.ManualJournals?.[0]?.ManualJournalID ?? null;
    const journalState = result.ManualJournals?.[0]?.Status ?? 'POSTED';
    await logSync(businessId, 'stocktake_journal', stocktakeId, journalId, 'success',
      `Journal posted: ${journalLines.length / 2} variance lines, total $${totalValue.toFixed(2)}`,
      journalState);
    await markStocktakeXeroStatus(stocktakeId, 'synced', journalId);
    return { journalId, lines: journalLines.length / 2, totalValue };
  } catch (err: any) {
    await logSync(businessId, 'stocktake_journal', stocktakeId, null, 'error', err.message);
    await markStocktakeXeroStatus(stocktakeId, 'error');
    throw err;
  }
}

/** Write Xero sync status back to the SO row. Silent — never throws.
 * xeroId === undefined → don't touch xero_invoice_id
 * xeroId === null     → explicitly clear xero_invoice_id to NULL (e.g. after void)
 * xeroId === string   → set xero_invoice_id to that value
 */
export async function markSoXeroStatus(
  soId: number,
  status: 'synced' | 'queued' | 'error',
  xeroId?: string | null,
): Promise<void> {
  try {
    await imsExecute(
      `UPDATE ims_sales_orders
         SET xero_sync_status = ?, xero_synced_at = NOW()
             ${xeroId !== undefined ? ', xero_invoice_id = ?' : ''}
         WHERE id = ?`,
      xeroId !== undefined ? [status, xeroId, soId] : [status, soId],
    );
  } catch { /* non-critical */ }
}

// ─── PO → Bill ───────────────────────────────────────────────────────────────

interface POForSync {
  id: number;
  po_number: string;
  supplier_id?: number;
  supplier_name?: string;
  location_id: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  subtotal: number;
  tax_amount: number;
  freight?: number;
  discount?: number;
  total_amount: number;
  currency_code?: string;
  tax_treatment?: 'ex_tax' | 'inc_tax' | 'no_tax';
  supplier_invoice_number?: string;
  supplier_invoice_date?: string;
  payment_terms?: string;
  items?: {
    variant_id: string;
    sku?: string;
    product_name?: string;
    qty_ordered: number;
    unit_cost: number;
    tax_rate: number;
    line_total: number;
  }[];
  payments?: { amount: number; payment_date: string }[];
}

/** Calculate DueDate from supplier_invoice_date + payment_terms, falling back to expected_date / order_date. */
function calcDueDate(po: POForSync): string {
  const base = po.supplier_invoice_date || po.order_date;
  const m = (po.payment_terms ?? '').match(/\d+/);
  const days = m ? parseInt(m[0]) : 0;
  if (days > 0) {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  return base;
}

/**
 * Create a Draft Bill in Xero from a PO.
 * Called when a PO is created or first synced.
 */
export async function syncPOAsDraftBill(businessId: string, po: POForSync): Promise<string | null> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  if (!accounts.inventory_asset) {
    await logSync(businessId, 'po_bill', po.id, null, 'skipped', 'No inventory_asset account mapped');
    return null;
  }

  // Determine line account: if PO has any payments, use "in transit"; otherwise "asset"
  const hasDeposits = (po.payments?.length ?? 0) > 0;
  const lineAccountCode = hasDeposits
    ? (accounts.inventory_in_transit || accounts.inventory_asset)
    : accounts.inventory_asset;

  const tracking = getTrackingForLocation(trackingMappings, po.location_id);

  const taxTreatment = po.tax_treatment ?? 'ex_tax';
  const lineTaxType = taxTreatment === 'no_tax' ? taxTypes.exempt : taxTypes.purchases;

  const lineItems = (po.items ?? []).map(item => ({
    Description: `${item.sku || ''} ${item.product_name || ''}`.trim() || 'Inventory',
    Quantity: item.qty_ordered,
    UnitAmount: item.unit_cost,
    AccountCode: lineAccountCode,
    ...(lineTaxType ? { TaxType: lineTaxType } : {}),
    Tracking: tracking,
  }));

  // Add freight as a separate line if present.
  // Capitalise → debit the same Inventory Asset account as stock (freight is part of stock value).
  // Expense    → debit the mapped Freight/Shipping P&L account.
  if (po.freight && po.freight > 0) {
    const freightTreatment = await getFreightTreatment(businessId);
    const freightAccount = freightTreatment === 'capitalise'
      ? lineAccountCode
      : (accounts.freight || lineAccountCode);
    lineItems.push({
      Description: freightTreatment === 'capitalise' ? 'Freight / Shipping (capitalised to stock)' : 'Freight / Shipping',
      Quantity: 1,
      UnitAmount: po.freight,
      AccountCode: freightAccount,
      ...(lineTaxType ? { TaxType: lineTaxType } : {}),
      Tracking: tracking,
    });
  }

  const bill: any = {
    Type: 'ACCPAY',
    Contact: { Name: po.supplier_name || `Supplier #${po.supplier_id}` },
    Date: po.order_date,
    DueDate: calcDueDate(po),
    Reference: po.po_number,
    Status: 'DRAFT',
    LineAmountTypes: taxTreatment === 'inc_tax' ? 'Inclusive' : 'Exclusive',
    CurrencyCode: po.currency_code || 'AUD',
    LineItems: lineItems,
  };

  if (po.supplier_invoice_number) {
    bill.InvoiceNumber = po.supplier_invoice_number;
  }

  try {
    const result = await xeroApiFetch(businessId, '/Invoices', { method: 'POST', body: { Invoices: [bill] } });
    const inv = result.Invoices?.[0];
    const xeroId = inv?.InvoiceID ?? null;
    await logSync(businessId, 'po_bill', po.id, xeroId, 'success', `Draft Bill created: ${po.po_number}`, inv?.Status ?? 'DRAFT');
    await markPoXeroStatus(po.id, 'synced', xeroId);
    return xeroId;
  } catch (err: any) {
    await logSync(businessId, 'po_bill', po.id, null, 'error', err.message);
    // Status will be set to 'queued' by the hook after retry logic
    return null;
  }
}

/**
 * Update an existing DRAFT Bill in Xero with the current PO data.
 * Called when a PO is edited (items, supplier, dates, freight) without a status change.
 * Skips silently if the bill is no longer DRAFT (e.g. already AUTHORISED).
 */
export async function updateXeroDraftBill(businessId: string, po: POForSync, xeroId: string): Promise<boolean> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  if (!accounts.inventory_asset) {
    await logSync(businessId, 'po_bill', po.id, xeroId, 'skipped', 'No inventory_asset account mapped');
    return false;
  }

  // Only DRAFT bills can be updated via the Xero API — check current status first
  try {
    const current = await xeroApiFetch(businessId, `/Invoices/${xeroId}`, { method: 'GET' });
    const currentStatus = current.Invoices?.[0]?.Status;
    if (currentStatus !== 'DRAFT') {
      await logSync(businessId, 'po_bill', po.id, xeroId, 'skipped', `Bill is ${currentStatus ?? 'unknown'}, cannot update`, currentStatus ?? undefined);
      return false;
    }
  } catch (err: any) {
    await logSync(businessId, 'po_bill', po.id, xeroId, 'error', `Failed to fetch bill status: ${err.message}`);
    return false;
  }

  const hasDeposits = (po.payments?.length ?? 0) > 0;
  const lineAccountCode = hasDeposits
    ? (accounts.inventory_in_transit || accounts.inventory_asset)
    : accounts.inventory_asset;

  const tracking = getTrackingForLocation(trackingMappings, po.location_id);
  const taxTreatment = po.tax_treatment ?? 'ex_tax';
  const lineTaxType = taxTreatment === 'no_tax' ? taxTypes.exempt : taxTypes.purchases;

  const lineItems = (po.items ?? []).map(item => ({
    Description: `${item.sku || ''} ${item.product_name || ''}`.trim() || 'Inventory',
    Quantity: item.qty_ordered,
    UnitAmount: item.unit_cost,
    AccountCode: lineAccountCode,
    ...(lineTaxType ? { TaxType: lineTaxType } : {}),
    Tracking: tracking,
  }));

  if (po.freight && po.freight > 0) {
    const freightTreatment = await getFreightTreatment(businessId);
    const freightAccount = freightTreatment === 'capitalise'
      ? lineAccountCode
      : (accounts.freight || lineAccountCode);
    lineItems.push({
      Description: freightTreatment === 'capitalise' ? 'Freight / Shipping (capitalised to stock)' : 'Freight / Shipping',
      Quantity: 1,
      UnitAmount: po.freight,
      AccountCode: freightAccount,
      ...(lineTaxType ? { TaxType: lineTaxType } : {}),
      Tracking: tracking,
    });
  }

  const bill: any = {
    InvoiceID: xeroId,
    Type: 'ACCPAY',
    Contact: { Name: po.supplier_name || `Supplier #${po.supplier_id}` },
    Date: po.order_date,
    DueDate: calcDueDate(po),
    Reference: po.po_number,
    Status: 'DRAFT',
    LineAmountTypes: taxTreatment === 'inc_tax' ? 'Inclusive' : 'Exclusive',
    CurrencyCode: po.currency_code || 'AUD',
    LineItems: lineItems,
  };

  if (po.supplier_invoice_number) {
    bill.InvoiceNumber = po.supplier_invoice_number;
  }

  try {
    await xeroApiFetch(businessId, `/Invoices/${xeroId}`, { method: 'POST', body: { Invoices: [bill] } });
    await logSync(businessId, 'po_bill', po.id, xeroId, 'success', `Draft Bill updated: ${po.po_number}`, 'DRAFT');
    await markPoXeroStatus(po.id, 'synced', xeroId);
    return true;
  } catch (err: any) {
    await logSync(businessId, 'po_bill', po.id, xeroId, 'error', `Update failed: ${err.message}`);
    return false;
  }
}

/**
 * Approve a Bill in Xero (when PO is received or has a payment).
 */
export async function approveBill(businessId: string, xeroInvoiceId: string, poId: number): Promise<boolean> {
  try {
    await xeroApiFetch(businessId, `/Invoices/${xeroInvoiceId}`, {
      method: 'POST',
      body: { Invoices: [{ InvoiceID: xeroInvoiceId, Status: 'AUTHORISED' }] },
    });
    await logSync(businessId, 'po_bill', poId, xeroInvoiceId, 'success', 'Bill approved', 'AUTHORISED');
    return true;
  } catch (err: any) {
    await logSync(businessId, 'po_bill', poId, xeroInvoiceId, 'error', `Approve failed: ${err.message}`);
    return false;
  }
}

// ─── PO Payment → Xero Payment ──────────────────────────────────────────────

/**
 * Record a payment against an approved Xero Bill.
 */
export async function syncPOPayment(
  businessId: string,
  xeroInvoiceId: string,
  poId: number,
  amount: number,
  paymentDate: string,
  currencyCode: string = 'AUD',
  xeroAccountCode: string,
): Promise<string | null> {
  const payment = {
    Invoice: { InvoiceID: xeroInvoiceId },
    Account: { Code: xeroAccountCode },
    Amount: amount,
    Date: paymentDate,
    CurrencyRate: 1,
  };

  try {
    const result = await xeroApiFetch(businessId, '/Payments', { method: 'POST', body: { Payments: [payment] } });
    const paymentId = result.Payments?.[0]?.PaymentID ?? null;
    await logSync(businessId, 'po_payment', poId, paymentId, 'success', `Payment $${amount} on ${paymentDate}`);
    return paymentId;
  } catch (err: any) {
    await logSync(businessId, 'po_payment', poId, null, 'error', err.message);
    return null;
  }
}

export async function syncSOPayment(
  businessId: string,
  xeroInvoiceId: string,
  soId: number,
  amount: number,
  paymentDate: string,
  currencyCode: string = 'AUD',
  xeroAccountCode: string,
): Promise<string | null> {
  const payment = {
    Invoice: { InvoiceID: xeroInvoiceId },
    Account: { Code: xeroAccountCode },
    Amount: amount,
    Date: paymentDate,
    CurrencyRate: 1,
  };

  try {
    const result = await xeroApiFetch(businessId, '/Payments', { method: 'POST', body: { Payments: [payment] } });
    const paymentId = result.Payments?.[0]?.PaymentID ?? null;
    await logSync(businessId, 'so_payment', soId, paymentId, 'success', `Payment $${amount} on ${paymentDate}`);
    return paymentId;
  } catch (err: any) {
    await logSync(businessId, 'so_payment', soId, null, 'error', err.message);
    return null;
  }
}

// ─── PO Received (with deposits) → Transfer Journal ──────────────────────────

/**
 * When a PO is received and had prior deposits (coded to "Inventory in Transit"),
 * post a journal to move the value:  DR Inventory Asset, CR Inventory in Transit.
 */
export async function syncPOReceivedJournal(
  businessId: string,
  poId: number,
  poNumber: string,
  amount: number,
  locationId: number,
): Promise<string | null> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);

  if (!accounts.inventory_asset || !accounts.inventory_in_transit) {
    await logSync(businessId, 'po_bill', poId, null, 'skipped', 'Missing account mappings for received journal');
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, locationId);

  const journal = {
    Narration: `PO ${poNumber} received — transfer from In Transit to Inventory Asset`,
    JournalLines: [
      { AccountCode: accounts.inventory_asset, DebitAmount: amount, Tracking: tracking },
      { AccountCode: accounts.inventory_in_transit, CreditAmount: amount, Tracking: tracking },
    ],
  };

  try {
    const result = await xeroApiFetch(businessId, '/ManualJournals', { method: 'POST', body: { ManualJournals: [journal] } });
    const journalId = result.ManualJournals?.[0]?.ManualJournalID ?? null;
    await logSync(businessId, 'po_bill', poId, journalId, 'success', `Received journal posted: $${amount}`);
    return journalId;
  } catch (err: any) {
    await logSync(businessId, 'po_bill', poId, null, 'error', `Received journal failed: ${err.message}`);
    return null;
  }
}

// ─── SO → Xero Invoice ───────────────────────────────────────────────────────

interface SOForSync {
  id: number;
  so_number: string;
  customer_id?: number;
  customer_name?: string;
  location_id: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  subtotal: number;
  tax_amount: number;
  freight?: number;
  discount?: number;
  total_amount: number;
  currency_code?: string;
  items?: {
    code?: string;
    name?: string;
    qty_ordered: number;
    unit_price: number;
    discount_pct: number;
    tax_rate: number;
    line_total: number;
  }[];
}

/**
 * Create a Xero Invoice from a wholesale Sales Order.
 */
export async function syncSOAsInvoice(businessId: string, so: SOForSync): Promise<string | null> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  if (!accounts.sales_revenue) {
    await logSync(businessId, 'so_invoice', so.id, null, 'skipped', 'No sales_revenue account mapped');
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, so.location_id, 'wholesale');

  const lineItems = (so.items ?? []).map(item => ({
    Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Sale',
    Quantity: item.qty_ordered,
    UnitAmount: item.unit_price,
    DiscountRate: item.discount_pct || 0,
    AccountCode: accounts.sales_revenue,
    ...((item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt) ? { TaxType: item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt } : {}),
    Tracking: tracking,
  }));

  if (so.freight && so.freight > 0) {
    lineItems.push({
      Description: 'Freight / Shipping',
      Quantity: 1,
      UnitAmount: so.freight,
      DiscountRate: 0,
      AccountCode: accounts.freight || accounts.sales_revenue,
      ...(taxTypes.exempt ? { TaxType: taxTypes.exempt } : {}),
      Tracking: tracking,
    });
  }

  const invoice: any = {
    Type: 'ACCREC',
    Contact: { Name: so.customer_name || `Customer #${so.customer_id}` },
    Date: so.order_date,
    DueDate: so.expected_date || so.order_date,
    Reference: so.so_number,
    Status: 'DRAFT',
    LineAmountTypes: 'Exclusive',
    CurrencyCode: so.currency_code || 'AUD',
    LineItems: lineItems,
  };

  try {
    const result = await xeroApiFetch(businessId, '/Invoices', { method: 'POST', body: { Invoices: [invoice] } });
    const inv = result.Invoices?.[0];
    const xeroId = inv?.InvoiceID ?? null;
    await logSync(businessId, 'so_invoice', so.id, xeroId, 'success', `Invoice created: ${so.so_number}`, inv?.Status ?? 'DRAFT');
    await markSoXeroStatus(so.id, 'synced', xeroId);
    return xeroId;
  } catch (err: any) {
    await logSync(businessId, 'so_invoice', so.id, null, 'error', err.message);
    // Status will be set to 'queued' by the hook after retry logic
    return null;
  }
}

/**
 * Update an existing DRAFT Invoice in Xero with the current SO data.
 * Skips silently if the invoice is no longer DRAFT (e.g. already AUTHORISED).
 */
export async function updateXeroDraftInvoice(businessId: string, so: SOForSync, xeroId: string): Promise<boolean> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  if (!accounts.sales_revenue) {
    await logSync(businessId, 'so_invoice', so.id, xeroId, 'skipped', 'No sales_revenue account mapped');
    return false;
  }

  try {
    const current = await xeroApiFetch(businessId, `/Invoices/${xeroId}`, { method: 'GET' });
    const currentStatus = current.Invoices?.[0]?.Status;
    if (currentStatus !== 'DRAFT') {
      await logSync(businessId, 'so_invoice', so.id, xeroId, 'skipped', `Invoice is ${currentStatus ?? 'unknown'}, cannot update`, currentStatus ?? undefined);
      return false;
    }
  } catch (err: any) {
    await logSync(businessId, 'so_invoice', so.id, xeroId, 'error', `Failed to fetch invoice status: ${err.message}`);
    return false;
  }

  const tracking = getTrackingForLocation(trackingMappings, so.location_id, 'wholesale');
  const lineItems = (so.items ?? []).map(item => ({
    Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Sale',
    Quantity: item.qty_ordered,
    UnitAmount: item.unit_price,
    DiscountRate: item.discount_pct || 0,
    AccountCode: accounts.sales_revenue,
    ...((item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt) ? { TaxType: item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt } : {}),
    Tracking: tracking,
  }));

  if (so.freight && so.freight > 0) {
    lineItems.push({
      Description: 'Freight / Shipping',
      Quantity: 1,
      UnitAmount: so.freight,
      DiscountRate: 0,
      AccountCode: accounts.freight || accounts.sales_revenue,
      ...(taxTypes.exempt ? { TaxType: taxTypes.exempt } : {}),
      Tracking: tracking,
    });
  }

  const invoice: any = {
    InvoiceID: xeroId,
    Type: 'ACCREC',
    Contact: { Name: so.customer_name || `Customer #${so.customer_id}` },
    Date: so.order_date,
    DueDate: so.expected_date || so.order_date,
    Reference: so.so_number,
    Status: 'DRAFT',
    LineAmountTypes: 'Exclusive',
    CurrencyCode: so.currency_code || 'AUD',
    LineItems: lineItems,
  };

  try {
    await xeroApiFetch(businessId, `/Invoices/${xeroId}`, { method: 'POST', body: { Invoices: [invoice] } });
    await logSync(businessId, 'so_invoice', so.id, xeroId, 'success', `Draft Invoice updated: ${so.so_number}`, 'DRAFT');
    await markSoXeroStatus(so.id, 'synced', xeroId);
    return true;
  } catch (err: any) {
    await logSync(businessId, 'so_invoice', so.id, xeroId, 'error', `Update failed: ${err.message}`);
    return false;
  }
}

/**
 * Approve a Xero ACCREC Invoice (set Status: AUTHORISED) — called when SO is fulfilled.
 */
export async function approveInvoice(businessId: string, xeroInvoiceId: string, soId: number): Promise<boolean> {
  try {
    await xeroApiFetch(businessId, `/Invoices/${xeroInvoiceId}`, {
      method: 'POST',
      body: { Invoices: [{ InvoiceID: xeroInvoiceId, Status: 'AUTHORISED' }] },
    });
    await logSync(businessId, 'so_invoice', soId, xeroInvoiceId, 'success', 'Invoice approved', 'AUTHORISED');
    return true;
  } catch (err: any) {
    await logSync(businessId, 'so_invoice', soId, xeroInvoiceId, 'error', `Approve failed: ${err.message}`);
    return false;
  }
}

// ─── Void Bill / Invoice ─────────────────────────────────────────────────────

/**
 * Void a Xero Bill (ACCPAY) by its InvoiceID.
 * Safe for DRAFT bills — they cannot have payments, so voiding is always possible.
 * Returns the xeroInvoiceId on success, null on failure (failure is logged).
 */
export async function voidXeroBill(
  businessId: string,
  xeroInvoiceId: string,
  poId: number,
): Promise<string | null> {
  try {
    // Xero rules: DRAFT bills must be DELETED; AUTHORISED bills must be VOIDED.
    const current = await xeroApiFetch(businessId, `/Invoices/${xeroInvoiceId}`);
    const currentStatus = current?.Invoices?.[0]?.Status ?? 'DRAFT';
    const targetStatus = currentStatus === 'AUTHORISED' ? 'VOIDED' : 'DELETED';

    const res = await xeroApiFetch(businessId, `/Invoices/${xeroInvoiceId}`, {
      method: 'POST',
      body: { Invoices: [{ InvoiceID: xeroInvoiceId, Status: targetStatus }] },
    });
    const result = res?.Invoices?.[0];
    if (result?.Status === targetStatus) {
      await logSync(businessId, 'po_bill_void', poId, xeroInvoiceId, 'success', `Bill ${targetStatus.toLowerCase()}`, targetStatus);
      return xeroInvoiceId;
    }
    await logSync(businessId, 'po_bill_void', poId, xeroInvoiceId, 'error', `Expected ${targetStatus}, got ${result?.Status}`);
    return null;
  } catch (e: any) {
    await logSync(businessId, 'po_bill_void', poId, xeroInvoiceId, 'error', e.message);
    return null;
  }
}

/**
 * Void a Xero Invoice (ACCREC) by its InvoiceID.
 * First checks whether payments have been applied — only voids if the full amount is still outstanding.
 * Returns { voided, hasPayments }.
 */
export async function voidXeroInvoice(
  businessId: string,
  xeroInvoiceId: string,
  soId: number,
): Promise<{ voided: boolean; hasPayments: boolean }> {
  try {
    const res = await xeroApiFetch(businessId, `/Invoices/${xeroInvoiceId}`);
    const invoice = res?.Invoices?.[0];
    if (!invoice) {
      await logSync(businessId, 'so_invoice_void', soId, xeroInvoiceId, 'error', 'Invoice not found in Xero');
      return { voided: false, hasPayments: false };
    }

    const amountDue = Number(invoice.AmountDue ?? 0);
    const total = Number(invoice.Total ?? 0);
    const hasPayments = total > 0 && amountDue < total;
    const currentStatus = invoice.Status as string;

    if (hasPayments) {
      await logSync(
        businessId, 'so_invoice_void', soId, xeroInvoiceId, 'skipped',
        `Invoice has payments applied (outstanding: ${amountDue}, total: ${total}) — manual void required`,
      );
      return { voided: false, hasPayments: true };
    }

    // Xero rules: DRAFT invoices must be DELETED; AUTHORISED invoices must be VOIDED.
    const targetStatus = currentStatus === 'AUTHORISED' ? 'VOIDED' : 'DELETED';
    const voidRes = await xeroApiFetch(businessId, `/Invoices/${xeroInvoiceId}`, {
      method: 'POST',
      body: { Invoices: [{ InvoiceID: xeroInvoiceId, Status: targetStatus }] },
    });
    const voided = voidRes?.Invoices?.[0];
    if (voided?.Status === targetStatus) {
      await logSync(businessId, 'so_invoice_void', soId, xeroInvoiceId, 'success', `Invoice ${targetStatus.toLowerCase()}`, targetStatus);
      return { voided: true, hasPayments: false };
    }
    await logSync(businessId, 'so_invoice_void', soId, xeroInvoiceId, 'error', `Expected ${targetStatus}, got ${voided?.Status}`);
    return { voided: false, hasPayments: false };
  } catch (e: any) {
    await logSync(businessId, 'so_invoice_void', soId, xeroInvoiceId, 'error', e.message);
    return { voided: false, hasPayments: false };
  }
}

// ─── POS/Online Daily Batch → Summary Invoice ────────────────────────────────

interface DailySalesBatch {
  date: string;          // YYYY-MM-DD
  locationId?: number;   // null for online
  channel: 'pos' | 'online';
  totalSales: number;
  totalTax: number;
  lineDescription: string;
}

/**
 * Post a single summary invoice for a day's POS or online sales.
 */
export async function syncDailySalesBatch(businessId: string, batch: DailySalesBatch): Promise<string | null> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);

  if (!accounts.sales_revenue) {
    await logSync(businessId, batch.channel === 'pos' ? 'pos_batch' : 'online_batch', null, null, 'skipped', 'No sales_revenue account mapped');
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, batch.locationId ?? null, batch.channel);

  const invoice: any = {
    Type: 'ACCREC',
    Contact: { Name: batch.channel === 'pos' ? 'POS Sales (Summary)' : 'Online Sales (Summary)' },
    Date: batch.date,
    DueDate: batch.date,
    Reference: `${batch.channel.toUpperCase()}-${batch.date}${batch.locationId ? `-L${batch.locationId}` : ''}`,
    Status: 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
    CurrencyCode: 'AUD',
    LineItems: [{
      Description: batch.lineDescription,
      Quantity: 1,
      UnitAmount: batch.totalSales,
      AccountCode: accounts.sales_revenue,
      TaxAmount: batch.totalTax,
      Tracking: tracking,
    }],
  };

  try {
    const result = await xeroApiFetch(businessId, '/Invoices', { method: 'POST', body: { Invoices: [invoice] } });
    const batchInv = result.Invoices?.[0];
    const xeroId = batchInv?.InvoiceID ?? null;
    const syncType = batch.channel === 'pos' ? 'pos_batch' : 'online_batch';
    await logSync(businessId, syncType, null, xeroId, 'success', `${batch.channel} batch ${batch.date}`, batchInv?.Status ?? 'AUTHORISED');
    return xeroId;
  } catch (err: any) {
    const syncType = batch.channel === 'pos' ? 'pos_batch' : 'online_batch';
    await logSync(businessId, syncType, null, null, 'error', err.message);
    return null;
  }
}

// ─── Monthly COGS Journal ────────────────────────────────────────────────────

/**
 * Post a manual journal: DR Cost of Goods Sold, CR Inventory Asset.
 * Amount = sum(qty_sold × avg_cost) for the given month.
 */
export async function syncMonthlyCOGSJournal(
  businessId: string,
  month: string, // YYYY-MM
  totalCOGS: number,
  locationId?: number,
): Promise<string | null> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);

  if (!accounts.cogs || !accounts.inventory_asset) {
    await logSync(businessId, 'cogs_journal', null, null, 'skipped', 'Missing COGS or Inventory Asset account mapping');
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, locationId ?? null);

  const journal = {
    Narration: `Monthly COGS — ${month}${locationId ? ` (Location ${locationId})` : ''}`,
    Date: `${month}-01`,
    JournalLines: [
      { AccountCode: accounts.cogs, DebitAmount: totalCOGS, Tracking: tracking },
      { AccountCode: accounts.inventory_asset, CreditAmount: totalCOGS, Tracking: tracking },
    ],
  };

  try {
    const result = await xeroApiFetch(businessId, '/ManualJournals', { method: 'POST', body: { ManualJournals: [journal] } });
    const journalId = result.ManualJournals?.[0]?.ManualJournalID ?? null;
    await logSync(businessId, 'cogs_journal', null, journalId, 'success', `COGS journal ${month}: $${totalCOGS.toFixed(2)}`);
    return journalId;
  } catch (err: any) {
    await logSync(businessId, 'cogs_journal', null, null, 'error', err.message);
    return null;
  }
}

// ─── POS EOD → Xero (one invoice per payment method) ─────────────────────────

/**
 * Post a single ACCREC AUTHORISED invoice for one EOD payment method.
 * Reference: EOD-L{locationId}-{YYYYMMDD}-{Method}
 * This is the trigger that replaces the old manual daily-sales sync.
 */
export async function syncEodEntry(
  businessId: string,
  entry: {
    date: string;
    locationId: number;
    locationName: string;
    registerId?: number | null;
    registerName?: string | null;
    sessionId?: number | null;
    method: string;
    salesAmount: number; // cash: counted − float; others: counted
  },
): Promise<{ xeroId: string; invoiceNumber: string } | null> {
  const accounts         = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);

  if (!accounts.sales_revenue) {
    await logSync(businessId, 'eod_reconciliation', null, null, 'skipped',
      `No sales_revenue account mapped — EOD ${entry.date} ${entry.method}`);
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, entry.locationId);
  const regSuffix  = entry.registerId ? `-R${entry.registerId}` : '';
  const sessSuffix = entry.sessionId  ? `-S${entry.sessionId}`  : '';
  const regLabel  = entry.registerName ? ` — ${entry.registerName}` : '';
  const sessLabel = entry.sessionId ? ` (Session #${entry.sessionId})` : '';

  const invoice: any = {
    Type:            'ACCREC',
    Contact:         { Name: 'POS Reconciliation (Summary)' },
    Date:            entry.date,
    DueDate:         entry.date,
    Reference:       `EOD-L${entry.locationId}${regSuffix}${sessSuffix}-${entry.date.replace(/-/g, '')}-${entry.method.replace(/\s+/g, '')}`,
    Status:          'AUTHORISED',
    LineAmountTypes: 'Inclusive',
    CurrencyCode:    'AUD',
    LineItems: [{
      Description: `${entry.method} Sales — ${entry.locationName}${regLabel}${sessLabel} — ${entry.date}`,
      Quantity:    1,
      UnitAmount:  entry.salesAmount,
      AccountCode: accounts.sales_revenue,
      TaxType:     'OUTPUT',
      Tracking:    tracking,
    }],
  };

  try {
    const result        = await xeroApiFetch(businessId, '/Invoices', { method: 'POST', body: { Invoices: [invoice] } });
    const inv           = result.Invoices?.[0];
    const xeroId        = inv?.InvoiceID ?? null;
    const invoiceNumber = inv?.InvoiceNumber ?? '';
    await logSync(businessId, 'eod_reconciliation', null, xeroId, 'success',
      `EOD ${entry.date} ${entry.method} — ${entry.locationName}: $${entry.salesAmount.toFixed(2)}`,
      inv?.Status ?? 'AUTHORISED');
    return xeroId ? { xeroId, invoiceNumber } : null;
  } catch (err: any) {
    await logSync(businessId, 'eod_reconciliation', null, null, 'error',
      `EOD ${entry.date} ${entry.method}: ${err.message}`);
    return null;
  }
}

/**
 * Trigger EOD Xero sync for all counted payment methods for a location/date.
 * Called fire-and-forget from POST /api/pos/eod on register close.
 * Also callable manually for retry.
 */
export async function triggerEodXeroSync(
  businessId: string,
  locationId: number,
  date: string,
  rows: Array<{
    payment_method: string;
    counted_amount: number | null;
    opening_float:  number | null;
    register_session_id?: number | null;
    xero_invoice_id?: string | null;
  }>,
  locationName: string,
  registerId: number | null,
  setXeroInvoice: (locationId: number, date: string, method: string, invoiceId: string, registerId?: number | null) => Promise<void>,
  registerName?: string | null,
): Promise<{ method: string; xeroId: string; invoiceNumber: string }[]> {
  const results: { method: string; xeroId: string; invoiceNumber: string }[] = [];
  for (const row of rows) {
    if (row.counted_amount == null) continue;
    // Skip re-sync if already synced
    if (row.xero_invoice_id) continue;
    const openFloat  = row.payment_method === 'Cash' ? (row.opening_float ?? 0) : 0;
    const salesAmount = row.counted_amount - openFloat;
    if (salesAmount <= 0) continue;
    const result = await syncEodEntry(businessId, {
      date, locationId, locationName,
      registerId: registerId ?? undefined,
      registerName: registerName ?? undefined,
      sessionId: row.register_session_id ?? undefined,
      method: row.payment_method,
      salesAmount,
    });
    if (result) {
      await setXeroInvoice(locationId, date, row.payment_method, result.xeroId, registerId);
      results.push({ method: row.payment_method, ...result });
    }
  }
  return results;
}

// ─── Credit Note → Xero Credit Note ──────────────────────────────────────────

export interface CNForSync {
  id: number;
  cn_number: string;
  customer_id?: number | null;
  customer_name?: string | null;
  location_id: number;
  cn_date: string;
  reference?: string | null;
  tax_treatment?: 'ex_tax' | 'inc_tax';
  total_amount: number;
  items?: {
    code?: string | null;
    name?: string | null;
    qty: number;
    unit_price: number;
    tax_rate: number;
    line_total: number;
  }[];
}

/** Write Xero sync status back to the CN row. Silent — never throws. */
export async function markCNXeroStatus(
  cnId: number,
  status: 'synced' | 'queued' | 'error',
  xeroId?: string | null,
): Promise<void> {
  try {
    await imsExecute(
      `UPDATE ims_credit_notes
         SET xero_sync_status = ?, xero_synced_at = NOW()
             ${xeroId !== undefined ? ', xero_credit_note_id = ?' : ''}
         WHERE id = ?`,
      xeroId !== undefined ? [status, xeroId, cnId] : [status, cnId],
    );
  } catch { /* non-critical */ }
}

/**
 * Post an AUTHORISED Xero Credit Note (ACCREC) for a completed Credit Note.
 * Returns the Xero CreditNoteID, or null on failure.
 */
export async function syncCNAsCreditNote(businessId: string, cn: CNForSync): Promise<string | null> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  const accountCode = accounts.credit_note || accounts.sales_revenue;
  if (!accountCode) {
    await logSync(businessId, 'cn_credit_note', cn.id, null, 'skipped', 'No credit_note or sales_revenue account mapped');
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, cn.location_id, 'wholesale');
  const lineAmountType = cn.tax_treatment === 'inc_tax' ? 'Inclusive' : 'Exclusive';

  const lineItems = (cn.items ?? []).map(item => ({
    Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Return',
    Quantity: item.qty,
    UnitAmount: item.unit_price,
    AccountCode: accountCode,
    ...((item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt)
      ? { TaxType: item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt }
      : {}),
    Tracking: tracking,
  }));

  if (!lineItems.length) {
    await logSync(businessId, 'cn_credit_note', cn.id, null, 'skipped', 'No line items');
    return null;
  }

  const creditNote: any = {
    Type: 'ACCREC',
    Contact: { Name: cn.customer_name || `Customer #${cn.customer_id}` },
    Date: cn.cn_date,
    CreditNoteNumber: cn.cn_number,
    Reference: cn.reference || cn.cn_number,
    Status: 'AUTHORISED',
    LineAmountTypes: lineAmountType,
    LineItems: lineItems,
  };

  try {
    const result = await xeroApiFetch(businessId, '/CreditNotes', {
      method: 'POST',
      body: { CreditNotes: [creditNote] },
    });
    const xeroId = result.CreditNotes?.[0]?.CreditNoteID ?? null;
    await logSync(businessId, 'cn_credit_note', cn.id, xeroId, 'success', `Credit note created: ${cn.cn_number}`, result.CreditNotes?.[0]?.Status ?? 'AUTHORISED');
    await markCNXeroStatus(cn.id, 'synced', xeroId);
    return xeroId;
  } catch (err: any) {
    await logSync(businessId, 'cn_credit_note', cn.id, null, 'error', err.message);
    return null;
  }
}
