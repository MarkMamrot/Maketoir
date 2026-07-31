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

import { getValidAccessToken, xeroApiFetch } from '@/services/XeroService';
import { query, execute } from '@/services/MySQLService';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { buildCogsJournalLines } from '@/lib/xero/cogsPeriods';
import { calculateCashPosition, splitExpectedCashTender } from '@/lib/ims/cashBankingMath';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface AccountMapping {
  inventory_asset?: string;
  inventory_in_transit?: string;
  cogs?: string;
  sales_revenue?: string;
  freight?: string;
  stock_adjustment?: string;
  credit_note?: string;
  rounding?: string; // Optional dedicated account for cash rounding adjustments
  cash_over_short?: string; // POS till and banking discrepancies
  gift_card_liability?: string; // Outstanding gift card balances (liability)
  store_credit_liability?: string; // Outstanding store credit balances (liability)
  supplier_credit_note?: string; // Non-stock supplier credit lines (rebates/overcharges)
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

async function getPosClearingMappings(businessId: string, locationId: number): Promise<Record<string, string>> {
  const rows = await query<{ payment_method: string; xero_account_code: string }>(
    `SELECT payment_method, xero_account_code
       FROM xero_pos_clearing_mappings
      WHERE business_id = ? AND ims_location_id = ?`,
    [businessId, locationId],
  );
  const mappings: Record<string, string> = {};
  for (const row of rows) {
    const key = row.payment_method.trim().toLowerCase();
    if (key) mappings[key] = row.xero_account_code;
  }
  return mappings;
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
  businessId: string,
  stocktakeId: number,
  status: 'synced' | 'queued' | 'error',
  xeroId?: string | null,
): Promise<void> {
  try {
    await imsExecute(
      `UPDATE ims_stocktakes
         SET xero_sync_status = ?, xero_synced_at = NOW()
             ${xeroId != null ? ', xero_journal_id = ?' : ''}
        WHERE id = ? AND business_id = ?`,
      xeroId != null ? [status, xeroId, stocktakeId, businessId] : [status, stocktakeId, businessId],
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
    await markStocktakeXeroStatus(businessId, stocktakeId, 'error');
    throw new Error('Missing Xero account mappings: inventory_asset and stock_adjustment are required');
  }

  // Fetch stocktake header + items with avg_cost joined from ims_stock
  const [stRows] = await Promise.all([
    imsQuery<{ id: number; reference: string; location_id: number; completed_at: string | null; status: string }>(
      `SELECT id, reference, location_id, completed_at, status FROM ims_stocktakes WHERE id = ? AND business_id = ?`,
      [stocktakeId, businessId],
    ),
  ]);
  const st = stRows[0];
  if (!st) throw new Error('Stocktake not found');
  if (st.status !== 'completed') throw new Error('Stocktake must be completed before syncing to Xero');

  const items = await imsQuery<{
    variant_id: string; sku: string | null; product_name: string;
    expected_qty: string; counted_qty: string | null;
    variant_avg_cost: string | null; cost_aud: string | null;
  }>(
    `SELECT si.variant_id,
            pv.sku,
            p.name AS product_name,
            si.expected_qty,
            si.counted_qty,
            pv.avg_cost AS variant_avg_cost,
            pv.cost_aud
       FROM ims_stocktake_items si
       JOIN ims_stocktakes st ON st.id = si.stocktake_id
       LEFT JOIN ims_product_variants pv ON pv.variant_id = si.variant_id AND pv.business_id = st.business_id
       LEFT JOIN ims_products p ON p.product_id = pv.product_id AND p.business_id = st.business_id
      WHERE si.stocktake_id = ? AND st.business_id = ?
        AND si.counted_qty IS NOT NULL`,
    [stocktakeId, businessId],
  );

  const tracking = getTrackingForLocation(trackingMappings, st.location_id);
  const journalDate = st.completed_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  const journalLines: any[] = [];
  let totalValue = 0;
  let skippedZeroValue = 0;

  for (const item of items) {
    const expected = Number(item.expected_qty);
    const counted  = Number(item.counted_qty);
    const variance = counted - expected;
    if (Math.abs(variance) < 0.00001) continue; // zero variance — skip

    const variantAvg  = Number(item.variant_avg_cost ?? 0);
    const fallbackAud = Number(item.cost_aud ?? 0);
    const avgCost     = variantAvg > 0 ? variantAvg : fallbackAud > 0 ? fallbackAud : 0;
    const absValue    = Math.abs(variance * avgCost);
    if (absValue < 0.00001) {
      skippedZeroValue += 1;
      continue;
    }
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
    const detail = skippedZeroValue > 0
      ? `No non-zero variance value to post (skipped ${skippedZeroValue} variance line${skippedZeroValue !== 1 ? 's' : ''} with zero unit cost).`
      : 'No non-zero variances to post';
    await logSync(businessId, 'stocktake_journal', stocktakeId, null, 'skipped', detail);
    await markStocktakeXeroStatus(businessId, stocktakeId, 'synced', null);
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
    const skippedSuffix = skippedZeroValue > 0
      ? `; skipped ${skippedZeroValue} zero-value variance line${skippedZeroValue !== 1 ? 's' : ''}`
      : '';
    await logSync(businessId, 'stocktake_journal', stocktakeId, journalId, 'success',
      `Journal posted: ${journalLines.length / 2} variance lines, total $${totalValue.toFixed(2)}${skippedSuffix}`,
      journalState);
    await markStocktakeXeroStatus(businessId, stocktakeId, 'synced', journalId);
    return { journalId, lines: journalLines.length / 2, totalValue };
  } catch (err: any) {
    await logSync(businessId, 'stocktake_journal', stocktakeId, null, 'error', err.message);
    await markStocktakeXeroStatus(businessId, stocktakeId, 'error');
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
    discount_pct: number;
    tax_rate: number;
    line_total: number;
  }[];
  payments?: { amount: number; payment_date: string }[];
}

function calcDueDateFromTerms(base: string, terms?: string): string {
  const m = (terms ?? '').match(/\d+/);
  const days = m ? parseInt(m[0], 10) : 0;
  if (days > 0) {
    const d = new Date(base);
    if (/\beom\b/i.test(terms ?? '')) {
      d.setMonth(d.getMonth() + 1, 0);
    }
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  return base;
}

/** Calculate PO DueDate from supplier_invoice_date/order_date and payment_terms. */
function calcPoDueDate(po: POForSync): string {
  const base = po.supplier_invoice_date || po.order_date;
  return calcDueDateFromTerms(base, po.payment_terms);
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
    DiscountRate: item.discount_pct ?? 0,
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
    DueDate: calcPoDueDate(po),
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
    DiscountRate: item.discount_pct ?? 0,
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
    DueDate: calcPoDueDate(po),
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
  payment_terms?: string;
  currency_code?: string;
  tax_treatment?: 'ex_tax' | 'inc_tax' | 'no_tax';
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
  const taxTreatment = so.tax_treatment ?? 'ex_tax';

  const lineItems = (so.items ?? []).map(item => ({
    Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Sale',
    Quantity: item.qty_ordered,
    UnitAmount: item.unit_price,
    DiscountRate: item.discount_pct || 0,
    AccountCode: accounts.sales_revenue,
    ...((taxTreatment !== 'no_tax' && item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt) ? { TaxType: taxTreatment !== 'no_tax' && item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt } : {}),
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
    DueDate: calcDueDateFromTerms(so.expected_date || so.order_date, so.payment_terms),
    Reference: so.so_number,
    Status: 'DRAFT',
    LineAmountTypes: taxTreatment === 'inc_tax' ? 'Inclusive' : 'Exclusive',
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
  const taxTreatment = so.tax_treatment ?? 'ex_tax';
  const lineItems = (so.items ?? []).map(item => ({
    Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Sale',
    Quantity: item.qty_ordered,
    UnitAmount: item.unit_price,
    DiscountRate: item.discount_pct || 0,
    AccountCode: accounts.sales_revenue,
    ...((taxTreatment !== 'no_tax' && item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt) ? { TaxType: taxTreatment !== 'no_tax' && item.tax_rate > 0 ? taxTypes.sales : taxTypes.exempt } : {}),
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
    DueDate: calcDueDateFromTerms(so.expected_date || so.order_date, so.payment_terms),
    Reference: so.so_number,
    Status: 'DRAFT',
    LineAmountTypes: taxTreatment === 'inc_tax' ? 'Inclusive' : 'Exclusive',
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

export async function updateXeroDraftSupplierCreditNote(businessId: string, scn: SupplierCNForSync, xeroId: string): Promise<boolean> {
  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  const restockAccount = accounts.inventory_asset;
  const nonStockAccount = accounts.supplier_credit_note || accounts.cogs;
  if (!restockAccount && !nonStockAccount) {
    await logSync(businessId, 'scn_credit_note', scn.id, xeroId, 'skipped', 'No inventory_asset / supplier_credit_note / cogs account mapped');
    return false;
  }

  try {
    const current = await xeroApiFetch(businessId, `/CreditNotes/${xeroId}`, { method: 'GET' });
    const currentStatus = current.CreditNotes?.[0]?.Status;
    if (currentStatus !== 'DRAFT') {
      await logSync(businessId, 'scn_credit_note', scn.id, xeroId, 'skipped', `Credit note is ${currentStatus ?? 'unknown'}, cannot update`, currentStatus ?? undefined);
      return false;
    }
  } catch (err: any) {
    await logSync(businessId, 'scn_credit_note', scn.id, xeroId, 'error', `Failed to fetch credit note status: ${err.message}`);
    return false;
  }

  const tracking = getTrackingForLocation(trackingMappings, scn.location_id, 'wholesale');
  const lineAmountType = scn.tax_treatment === 'inc_tax' ? 'Inclusive' : 'Exclusive';
  const lineItems = (scn.items ?? []).map(item => {
    const restock = item.restock === undefined || item.restock === null ? true : !!Number(item.restock);
    const acct = restock ? (restockAccount || nonStockAccount) : (nonStockAccount || restockAccount);
    const taxed = Number(item.tax_rate) > 0 && scn.tax_treatment !== 'no_tax';
    return {
      Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Supplier credit',
      Quantity: item.qty,
      UnitAmount: item.unit_cost,
      AccountCode: acct,
      TaxType: taxed ? taxTypes.purchases : taxTypes.exempt,
      Tracking: tracking,
    };
  });

  const creditNote: any = {
    CreditNoteID: xeroId,
    Type: 'ACCPAYCREDIT',
    Contact: { Name: scn.supplier_name || `Supplier #${scn.supplier_id}` },
    Date: scn.scn_date,
    CreditNoteNumber: scn.scn_number,
    Reference: scn.supplier_credit_ref || scn.reference || scn.scn_number,
    Status: 'DRAFT',
    LineAmountTypes: lineAmountType,
    LineItems: lineItems,
  };

  try {
    await xeroApiFetch(businessId, `/CreditNotes/${xeroId}`, { method: 'POST', body: { CreditNotes: [creditNote] } });
    await logSync(businessId, 'scn_credit_note', scn.id, xeroId, 'success', `Draft supplier credit note updated: ${scn.scn_number}`, 'DRAFT');
    await markSupplierCNXeroStatus(scn.id, 'synced', xeroId);
    return true;
  } catch (err: any) {
    await logSync(businessId, 'scn_credit_note', scn.id, xeroId, 'error', `Update failed: ${err.message}`);
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

async function fetchXeroCreditNoteById(businessId: string, xeroCreditNoteId: string): Promise<any | null> {
  try {
    const byPath = await xeroApiFetch(businessId, `/CreditNotes/${xeroCreditNoteId}`);
    const hit = byPath?.CreditNotes?.[0];
    if (hit) return hit;
  } catch {
    // Fallback to query variant for tenants where direct path is inconsistent.
  }

  try {
    const byQuery = await xeroApiFetch(businessId, `/CreditNotes?IDs=${xeroCreditNoteId}`);
    return byQuery?.CreditNotes?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function voidXeroCreditNote(
  businessId: string,
  xeroCreditNoteId: string,
  cnId: number,
): Promise<string | null> {
  try {
    const current = await fetchXeroCreditNoteById(businessId, xeroCreditNoteId);
    if (!current) {
      await logSync(businessId, 'cn_credit_note_void', cnId, xeroCreditNoteId, 'error', 'Credit note not found in Xero');
      return null;
    }

    const currentStatus = String(current.Status ?? '').toUpperCase();
    if (currentStatus === 'VOIDED' || currentStatus === 'DELETED') {
      await logSync(businessId, 'cn_credit_note_void', cnId, xeroCreditNoteId, 'success', `Credit note already ${currentStatus.toLowerCase()}`, currentStatus);
      await markCNXeroStatus(cnId, 'synced', null);
      return xeroCreditNoteId;
    }

    const targetStatus = currentStatus === 'DRAFT' ? 'DELETED' : 'VOIDED';
    const res = await xeroApiFetch(businessId, `/CreditNotes/${xeroCreditNoteId}`, {
      method: 'POST',
      body: { CreditNotes: [{ CreditNoteID: xeroCreditNoteId, Status: targetStatus }] },
    });
    const result = res?.CreditNotes?.[0];
    if (result?.Status === targetStatus) {
      await logSync(businessId, 'cn_credit_note_void', cnId, xeroCreditNoteId, 'success', `Credit note ${targetStatus.toLowerCase()}`, targetStatus);
      await markCNXeroStatus(cnId, 'synced', null);
      return xeroCreditNoteId;
    }

    await logSync(businessId, 'cn_credit_note_void', cnId, xeroCreditNoteId, 'error', `Expected ${targetStatus}, got ${result?.Status}`);
    return null;
  } catch (e: any) {
    await logSync(businessId, 'cn_credit_note_void', cnId, xeroCreditNoteId, 'error', e.message);
    return null;
  }
}

export async function voidXeroSupplierCreditNote(
  businessId: string,
  xeroCreditNoteId: string,
  scnId: number,
): Promise<string | null> {
  try {
    const current = await fetchXeroCreditNoteById(businessId, xeroCreditNoteId);
    if (!current) {
      await logSync(businessId, 'scn_credit_note_void', scnId, xeroCreditNoteId, 'error', 'Supplier credit note not found in Xero');
      return null;
    }

    const currentStatus = String(current.Status ?? '').toUpperCase();
    if (currentStatus === 'VOIDED' || currentStatus === 'DELETED') {
      await logSync(businessId, 'scn_credit_note_void', scnId, xeroCreditNoteId, 'success', `Supplier credit note already ${currentStatus.toLowerCase()}`, currentStatus);
      await markSupplierCNXeroStatus(scnId, 'synced', null);
      return xeroCreditNoteId;
    }

    const targetStatus = currentStatus === 'DRAFT' ? 'DELETED' : 'VOIDED';
    const res = await xeroApiFetch(businessId, `/CreditNotes/${xeroCreditNoteId}`, {
      method: 'POST',
      body: { CreditNotes: [{ CreditNoteID: xeroCreditNoteId, Status: targetStatus }] },
    });
    const result = res?.CreditNotes?.[0];
    if (result?.Status === targetStatus) {
      await logSync(businessId, 'scn_credit_note_void', scnId, xeroCreditNoteId, 'success', `Supplier credit note ${targetStatus.toLowerCase()}`, targetStatus);
      await markSupplierCNXeroStatus(scnId, 'synced', null);
      return xeroCreditNoteId;
    }

    await logSync(businessId, 'scn_credit_note_void', scnId, xeroCreditNoteId, 'error', `Expected ${targetStatus}, got ${result?.Status}`);
    return null;
  } catch (e: any) {
    await logSync(businessId, 'scn_credit_note_void', scnId, xeroCreditNoteId, 'error', e.message);
    return null;
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
  gateway?: string;            // payment gateway label (for description + dedup key)
  clearingAccountCode?: string; // if set, a Xero payment is applied into this bank/clearing account
  clearingPayments?: Array<{
    accountCode: string;
    amount: number;
    label?: string;
    paymentKey?: string;
    reference?: string;
    fee?: {
      amount: number;
      gatewayName: string;
      accountCode: string;
      taxType: 'INPUT' | 'NONE';
    };
  }>;
  payoutManaged?: boolean;
  gatewayAllocations?: Array<{
    gateway: string;
    amount: number;
    payoutManaged: boolean;
  }>;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
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
    Reference: `${batch.channel.toUpperCase()}-${batch.date}${batch.locationId ? `-L${batch.locationId}` : ''}${batch.gateway ? `-${batch.gateway.replace(/\s+/g, '').toUpperCase().slice(0, 12)}` : ''}`,
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

  // Derive the dedup key used in xero_sync_log (includes gateway when split by gateway).
  const batchKey = batch.gateway
    ? `${batch.channel} batch ${batch.date}|${batch.gateway.toLowerCase()}`
    : `${batch.channel} batch ${batch.date}`;
  const syncType = batch.channel === 'pos' ? 'pos_batch' : 'online_batch';
  const isCanonicalOnlineBatch = batch.channel === 'online' && !batch.gateway;
  let existingOnlineInvoiceId: string | null = null;

  if (isCanonicalOnlineBatch) {
    const existing = await query<{ xero_invoice_id: string | null }>(
      `SELECT xero_invoice_id
         FROM xero_online_batches
        WHERE business_id = ? AND batch_date = ?
        LIMIT 1`,
      [businessId, batch.date],
    );
    existingOnlineInvoiceId = existing[0]?.xero_invoice_id ?? null;

    if (!existingOnlineInvoiceId) {
      const historical = await query<{ xero_id: string }>(
        `SELECT xero_id
           FROM xero_sync_log
          WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
            AND detail = ? AND xero_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [businessId, batchKey],
      ).catch(() => []);
      existingOnlineInvoiceId = historical[0]?.xero_id ?? null;
    }
    if (existingOnlineInvoiceId) {
      await execute(
        `INSERT INTO xero_online_batches
           (business_id, batch_date, xero_invoice_id, invoice_total, invoice_status,
            gateway_allocations, payout_managed)
         VALUES (?, ?, ?, ?, 'AUTHORISED', ?, ?)
         ON DUPLICATE KEY UPDATE
           invoice_status = IF(xero_invoice_id IS NULL, VALUES(invoice_status), invoice_status),
           xero_invoice_id = COALESCE(xero_invoice_id, VALUES(xero_invoice_id))`,
        [
          businessId,
          batch.date,
          existingOnlineInvoiceId,
          roundCurrency(batch.totalSales + batch.totalTax),
          JSON.stringify(batch.gatewayAllocations ?? []),
          batch.payoutManaged ? 1 : 0,
        ],
      );
    }

    let claim = existingOnlineInvoiceId ? null : await execute(
      `INSERT IGNORE INTO xero_online_batches
         (business_id, batch_date, invoice_total, invoice_status, gateway_allocations, payout_managed)
       VALUES (?, ?, ?, 'posting', ?, ?)`,
      [
        businessId,
        batch.date,
        roundCurrency(batch.totalSales + batch.totalTax),
        JSON.stringify(batch.gatewayAllocations ?? []),
        batch.payoutManaged ? 1 : 0,
      ],
    );

    if (claim && claim.affectedRows === 0) {
      claim = await execute(
        `UPDATE xero_online_batches
            SET invoice_status = 'posting', error_detail = NULL,
                invoice_total = ?, gateway_allocations = ?, payout_managed = ?
          WHERE business_id = ? AND batch_date = ? AND xero_invoice_id IS NULL
            AND (
              invoice_status IN ('pending', 'error') OR
              (invoice_status = 'posting' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
            )`,
        [
          roundCurrency(batch.totalSales + batch.totalTax),
          JSON.stringify(batch.gatewayAllocations ?? []),
          batch.payoutManaged ? 1 : 0,
          businessId,
          batch.date,
        ],
      );
    }

    if (claim && claim.affectedRows === 0) {
      const current = await query<{ xero_invoice_id: string | null }>(
        `SELECT xero_invoice_id
           FROM xero_online_batches
          WHERE business_id = ? AND batch_date = ?
          LIMIT 1`,
        [businessId, batch.date],
      );
      return current[0]?.xero_invoice_id ?? null;
    }
  }

  try {
    const totalDue = Math.round((batch.totalSales + batch.totalTax) * 100) / 100;
    const invoiceIdempotencyKey = crypto.createHash('sha256')
      .update(`${businessId}|${batchKey}|invoice`)
      .digest('hex');
    let result;
    if (existingOnlineInvoiceId) {
      const currentResponse = await xeroApiFetch(businessId, `/Invoices/${encodeURIComponent(existingOnlineInvoiceId)}`);
      const currentInvoice = currentResponse?.Invoices?.[0];
      if (!currentInvoice) throw new Error(`Existing Xero online invoice ${existingOnlineInvoiceId} was not found`);
      const currentTotal = roundCurrency(Number(currentInvoice.Total ?? 0));
      const status = String(currentInvoice.Status ?? '').toUpperCase();
      if (status === 'VOIDED') {
        result = await xeroApiFetch(businessId, '/Invoices', {
          method: 'POST',
          idempotencyKey: crypto.createHash('sha256')
            .update(`${businessId}|${batchKey}|invoice-replacement|${totalDue.toFixed(2)}`)
            .digest('hex'),
          body: { Invoices: [invoice] },
        });
        existingOnlineInvoiceId = null;
      } else if (totalDue - currentTotal > 0.01) {
        const amountPaid = roundCurrency(Number(currentInvoice.AmountPaid ?? 0));
        const amountCredited = roundCurrency(Number(currentInvoice.AmountCredited ?? 0));
        if (!['DRAFT', 'SUBMITTED', 'AUTHORISED'].includes(status) || amountPaid !== 0 || amountCredited !== 0) {
          throw new Error(
            `Existing Xero online invoice ${existingOnlineInvoiceId} is ${status || 'UNKNOWN'} with `
            + `${amountPaid.toFixed(2)} paid and ${amountCredited.toFixed(2)} credited; `
            + `cannot increase it from ${currentTotal.toFixed(2)} to ${totalDue.toFixed(2)} automatically`,
          );
        }
        result = await xeroApiFetch(businessId, `/Invoices/${encodeURIComponent(existingOnlineInvoiceId)}`, {
          method: 'POST',
          idempotencyKey: crypto.createHash('sha256')
            .update(`${businessId}|${batchKey}|invoice-refresh|${totalDue.toFixed(2)}`)
            .digest('hex'),
          body: { Invoices: [{ ...invoice, InvoiceID: existingOnlineInvoiceId }] },
        });
      } else {
        if (currentTotal - totalDue > 0.01) {
          throw new Error(
            `Existing Xero online invoice ${existingOnlineInvoiceId} total ${currentTotal.toFixed(2)} `
            + `is above rebuilt batch total ${totalDue.toFixed(2)}; automatic reductions are blocked`,
          );
        }
        result = { Invoices: [currentInvoice] };
      }
    } else {
      result = await xeroApiFetch(businessId, '/Invoices', {
          method: 'POST',
          idempotencyKey: invoiceIdempotencyKey,
          body: { Invoices: [invoice] },
        });
    }
    const batchInv = result.Invoices?.[0];
    const xeroId = batchInv?.InvoiceID ?? null;

    if (batch.channel === 'online' && !batch.gateway && xeroId) {
      await execute(
        `INSERT INTO xero_online_batches
           (business_id, batch_date, xero_invoice_id, xero_invoice_number, invoice_total,
            invoice_status, gateway_allocations, payout_managed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           xero_invoice_id = VALUES(xero_invoice_id),
           xero_invoice_number = VALUES(xero_invoice_number),
           invoice_total = VALUES(invoice_total),
           invoice_status = VALUES(invoice_status),
           gateway_allocations = VALUES(gateway_allocations),
           payout_managed = VALUES(payout_managed),
           error_detail = NULL`,
        [
          businessId,
          batch.date,
          xeroId,
          batchInv?.InvoiceNumber ?? null,
          totalDue,
          batchInv?.Status ?? 'AUTHORISED',
          JSON.stringify(batch.gatewayAllocations ?? []),
          batch.payoutManaged ? 1 : 0,
        ],
      );
    }

    const configuredPayments = Array.isArray(batch.clearingPayments)
      ? batch.clearingPayments
      : [];
    const clearingPayments = configuredPayments.length > 0
      ? configuredPayments
      : (batch.clearingAccountCode
          ? [{
              accountCode: batch.clearingAccountCode,
              amount: totalDue,
              label: batch.gateway,
            }]
          : []);

    // If one or more clearing payments are configured, immediately apply them.
    // This marks the invoice as PAID (when the full amount is covered) and routes
    // funds to clearing accounts for bank reconciliation.
    if (xeroId && clearingPayments.length > 0) {
      try {
        for (const [paymentIndex, p] of clearingPayments.entries()) {
          const amount = Math.round(Number(p.amount ?? 0) * 100) / 100;
          if (!(amount > 0)) continue;
          const label = p.label || batch.gateway;
          const paymentKey = p.paymentKey || `${paymentIndex}|${p.accountCode}|${amount.toFixed(2)}`;
          let paymentCompleted = false;
          if (p.paymentKey) {
            let claim = await execute(
              `INSERT IGNORE INTO xero_online_order_payments
                 (business_id, payment_key, batch_date, xero_invoice_id, account_code, amount, reference, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'posting')`,
              [businessId, p.paymentKey, batch.date, xeroId, p.accountCode, amount, p.reference ?? null],
            );
            if (claim.affectedRows === 0) {
              claim = await execute(
                `UPDATE xero_online_order_payments
                    SET status = 'posting', error_detail = NULL,
                        xero_invoice_id = ?, account_code = ?, amount = ?, reference = ?
                  WHERE business_id = ? AND payment_key = ?
                    AND (
                      status IN ('pending', 'error') OR
                      (status = 'posting' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
                    )`,
                [xeroId, p.accountCode, amount, p.reference ?? null, businessId, p.paymentKey],
              );
            }
            if (claim.affectedRows === 0) {
              const existingPayment = await query<{ status: string }>(
                `SELECT status
                   FROM xero_online_order_payments
                  WHERE business_id = ? AND payment_key = ?
                  LIMIT 1`,
                [businessId, p.paymentKey],
              );
              if (existingPayment[0]?.status !== 'completed') continue;
              paymentCompleted = true;
            }
          }
          const paymentIdempotencyKey = crypto.createHash('sha256')
            .update(`${businessId}|${batchKey}|payment|${paymentKey}`)
            .digest('hex');
          try {
            if (!paymentCompleted) {
            const paymentResult = await xeroApiFetch(businessId, '/Payments', {
              method: 'POST',
              idempotencyKey: paymentIdempotencyKey,
              body: { Payments: [{
                Invoice: { InvoiceID: xeroId },
                Account: { Code: p.accountCode },
                Date: batch.date,
                Amount: amount,
                Reference: p.reference || `${batch.channel.toUpperCase()} clearing ${batch.date}${label ? ` (${label})` : ''}`,
              }] },
            });
            if (p.paymentKey) {
              await execute(
                `UPDATE xero_online_order_payments
                    SET status = 'completed', xero_payment_id = ?, error_detail = NULL
                  WHERE business_id = ? AND payment_key = ?`,
                [paymentResult?.Payments?.[0]?.PaymentID ?? null, businessId, p.paymentKey],
              );
            }
            paymentCompleted = true;
            }

            const feeAmount = roundCurrency(Number(p.fee?.amount ?? 0));
            if (paymentCompleted && p.paymentKey && p.fee && feeAmount > 0) {
              const feeKey = `${p.paymentKey}-fee`;
              let feeClaim = await execute(
                `INSERT IGNORE INTO xero_online_order_fees
                   (business_id, fee_key, payment_key, batch_date, gateway_name,
                    bank_account_code, fee_account_code, fee_tax_type, fee_amount, reference, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posting')`,
                [businessId, feeKey, p.paymentKey, batch.date, p.fee.gatewayName,
                 p.accountCode, p.fee.accountCode, p.fee.taxType, feeAmount, p.reference ?? null],
              );
              if (feeClaim.affectedRows === 0) {
                feeClaim = await execute(
                  `UPDATE xero_online_order_fees
                      SET status = 'posting', error_detail = NULL, fee_amount = ?, reference = ?
                    WHERE business_id = ? AND fee_key = ?
                      AND (
                        status IN ('pending', 'error') OR
                        (status = 'posting' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
                      )`,
                  [feeAmount, p.reference ?? null, businessId, feeKey],
                );
              }
              if (feeClaim.affectedRows > 0) {
                const feeIdempotencyKey = crypto.createHash('sha256')
                  .update(`${businessId}|${batchKey}|fee|${feeKey}`)
                  .digest('hex');
                try {
                  const feeResult = await xeroApiFetch(businessId, '/BankTransactions', {
                    method: 'POST',
                    idempotencyKey: feeIdempotencyKey,
                    body: { BankTransactions: [{
                      Type: 'SPEND',
                      Contact: { Name: p.fee.gatewayName },
                      Date: batch.date,
                      LineAmountTypes: p.fee.taxType === 'INPUT' ? 'Inclusive' : 'NoTax',
                      BankAccount: { Code: p.accountCode },
                      Reference: p.reference || `${p.fee.gatewayName} fee ${batch.date}`,
                      LineItems: [{
                        Description: p.reference || `${p.fee.gatewayName} processing fee`,
                        Quantity: 1,
                        UnitAmount: feeAmount,
                        AccountCode: p.fee.accountCode,
                        TaxType: p.fee.taxType,
                      }],
                    }] },
                  });
                  await execute(
                    `UPDATE xero_online_order_fees
                        SET status = 'completed', xero_bank_transaction_id = ?, error_detail = NULL
                      WHERE business_id = ? AND fee_key = ?`,
                    [feeResult?.BankTransactions?.[0]?.BankTransactionID ?? null, businessId, feeKey],
                  );
                } catch (feeError: any) {
                  await execute(
                    `UPDATE xero_online_order_fees
                        SET status = 'error', error_detail = ?
                      WHERE business_id = ? AND fee_key = ?`,
                    [feeError?.message ?? 'Fee posting failed', businessId, feeKey],
                  ).catch(() => {});
                  throw feeError;
                }
              }
            }
          } catch (paymentError: any) {
            if (p.paymentKey && !paymentCompleted) {
              await execute(
                `UPDATE xero_online_order_payments
                    SET status = 'error', error_detail = ?
                  WHERE business_id = ? AND payment_key = ?`,
                [paymentError?.message ?? 'Payment failed', businessId, p.paymentKey],
              ).catch(() => {});
            }
            throw paymentError;
          }
        }
      } catch (payErr: any) {
        // Invoice posted but payment failed — log separately; bookkeeper can apply manually.
        await logSync(businessId, syncType, null, xeroId, 'error',
          `Invoice ok but clearing payment failed: ${payErr.message}`, batchInv?.Status);
        return xeroId;
      }
    }

    await logSync(businessId, syncType, null, xeroId, 'success', batchKey, batchInv?.Status ?? 'AUTHORISED');
    return xeroId;
  } catch (err: any) {
    if (isCanonicalOnlineBatch) {
      await execute(
        `UPDATE xero_online_batches
            SET invoice_status = 'error', error_detail = ?
          WHERE business_id = ? AND batch_date = ? AND xero_invoice_id IS NULL`,
        [err.message, businessId, batch.date],
      ).catch(() => {});
    }
    await logSync(businessId, syncType, null, null, 'error', `${batchKey}: ${err.message}`);
    return null;
  }
}

export async function syncGiftCardIssueInvoice(input: {
  businessId: string;
  amount: number;
  issueDate: string;
  reference: string;
  narration?: string;
  dedupeKey: string;
  referenceId?: number;
}): Promise<string | null> {
  const amount = roundCurrency(Number(input.amount ?? 0));
  if (!(amount > 0)) return null;

  const existing = await query<{ id: number }>(
    `SELECT id
       FROM xero_sync_log
      WHERE business_id = ?
        AND sync_type = 'gift_card_issue'
        AND status = 'success'
        AND detail = ?
      LIMIT 1`,
    [input.businessId, input.dedupeKey],
  ).catch(() => [] as { id: number }[]);
  if (existing.length > 0) return null;

  const accounts = await getAccountMappings(input.businessId);
  if (!accounts.gift_card_liability) {
    await logSync(input.businessId, 'gift_card_issue', input.referenceId ?? null, null, 'skipped', `Missing gift_card_liability mapping: ${input.dedupeKey}`);
    return null;
  }

  const invoice: any = {
    Type: 'ACCREC',
    Contact: { Name: 'Gift Card Sales' },
    Date: input.issueDate,
    DueDate: input.issueDate,
    Reference: input.reference,
    Status: 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
    CurrencyCode: 'AUD',
    LineItems: [{
      Description: input.narration || 'Gift card issued',
      Quantity: 1,
      UnitAmount: amount,
      AccountCode: accounts.gift_card_liability,
      TaxType: 'NONE',
      TaxAmount: 0,
    }],
  };

  try {
    const res = await xeroApiFetch(input.businessId, '/Invoices', { method: 'POST', body: { Invoices: [invoice] } });
    const inv = res.Invoices?.[0];
    const xeroId = inv?.InvoiceID ?? null;
    if (!xeroId) {
      await logSync(input.businessId, 'gift_card_issue', input.referenceId ?? null, null, 'error', `No InvoiceID returned: ${input.dedupeKey}`);
      return null;
    }
    await logSync(input.businessId, 'gift_card_issue', input.referenceId ?? null, xeroId, 'success', input.dedupeKey, inv?.Status ?? 'AUTHORISED');
    return xeroId;
  } catch (err: any) {
    await logSync(input.businessId, 'gift_card_issue', input.referenceId ?? null, null, 'error', `${input.dedupeKey}: ${err.message}`);
    return null;
  }
}

export async function syncGiftCardLiabilityReclass(input: {
  businessId: string;
  amount: number;
  date: string;
  channel: 'pos' | 'online';
  locationId?: number;
  gateway?: string;
  dedupeKey: string;
}): Promise<string | null> {
  return syncDeferredLiabilityJournal({
    ...input,
    syncType: 'gift_card_liability',
    liabilityRole: 'gift_card_liability',
    liabilityLabel: 'Gift card',
    direction: 'issue',
  });
}

async function syncDeferredLiabilityJournal(input: {
  businessId: string;
  amount: number;
  date: string;
  channel: 'pos' | 'online';
  locationId?: number;
  gateway?: string;
  dedupeKey: string;
  referenceId?: number;
  syncType: 'gift_card_liability' | 'gift_card_redeem' | 'store_credit_issue' | 'store_credit_redeem';
  liabilityRole: 'gift_card_liability' | 'store_credit_liability';
  liabilityLabel: 'Gift card' | 'Store credit';
  direction: 'issue' | 'redeem';
}): Promise<string | null> {
  const amount = roundCurrency(Number(input.amount ?? 0));
  if (!(amount > 0)) return null;

  const existing = await query<{ id: number }>(
    `SELECT id
       FROM xero_sync_log
      WHERE business_id = ?
        AND sync_type = ?
        AND status = 'success'
        AND detail = ?
      LIMIT 1`,
    [input.businessId, input.syncType, input.dedupeKey],
  ).catch(() => [] as { id: number }[]);
  if (existing.length > 0) return null;

  const accounts = await getAccountMappings(input.businessId);
  const liabilityCode = input.liabilityRole === 'gift_card_liability'
    ? accounts.gift_card_liability
    : accounts.store_credit_liability;
  if (!accounts.sales_revenue || !liabilityCode) {
    await logSync(input.businessId, input.syncType, input.referenceId ?? null, null, 'skipped', `Missing sales_revenue or ${input.liabilityRole} mapping: ${input.dedupeKey}`);
    return null;
  }

  const trackingMappings = await getTrackingMappings(input.businessId);
  const tracking = getTrackingForLocation(trackingMappings, input.locationId ?? null, input.channel);
  const channelLabel = input.channel === 'pos' ? 'POS' : 'Online';
  const gatewayLabel = input.gateway ? ` (${input.gateway})` : '';
  const actionLabel = input.direction === 'redeem' ? 'redemption' : 'liability reclass';
  const description = `${input.liabilityLabel} ${actionLabel} - ${channelLabel}${gatewayLabel}`;

  const firstLine = input.direction === 'redeem'
    ? {
      Description: description,
      AccountCode: liabilityCode,
      DebitAmount: amount,
      TaxType: 'NONE',
      Tracking: tracking,
    }
    : {
      Description: description,
      AccountCode: accounts.sales_revenue,
      DebitAmount: amount,
      TaxType: 'NONE',
      Tracking: tracking,
    };

  const secondLine = input.direction === 'redeem'
    ? {
      Description: description,
      AccountCode: accounts.sales_revenue,
      CreditAmount: amount,
      TaxType: 'NONE',
      Tracking: tracking,
    }
    : {
      Description: description,
      AccountCode: liabilityCode,
      CreditAmount: amount,
      TaxType: 'NONE',
      Tracking: tracking,
    };

  const journal: any = {
    Date: input.date,
    Status: 'POSTED',
    Narration: `${input.liabilityLabel} ${actionLabel} - ${channelLabel} ${input.date}${gatewayLabel}`,
    ShowOnCashBasisReports: false,
    JournalLines: [firstLine, secondLine],
  };

  try {
    const idempotencyKey = crypto.createHash('sha256')
      .update(`${input.businessId}|${input.syncType}|${input.dedupeKey}`)
      .digest('hex');
    const res = await xeroApiFetch(input.businessId, '/ManualJournals', {
      method: 'POST',
      idempotencyKey,
      body: { ManualJournals: [journal] },
    });
    const j = res.ManualJournals?.[0];
    const xeroId = j?.ManualJournalID ?? null;
    if (!xeroId) {
      await logSync(input.businessId, input.syncType, input.referenceId ?? null, null, 'error', `No ManualJournalID returned: ${input.dedupeKey}`);
      return null;
    }
    await logSync(input.businessId, input.syncType, input.referenceId ?? null, xeroId, 'success', input.dedupeKey, j?.Status ?? 'POSTED');
    return xeroId;
  } catch (err: any) {
    await logSync(input.businessId, input.syncType, input.referenceId ?? null, null, 'error', `${input.dedupeKey}: ${err.message}`);
    return null;
  }
}

export async function syncGiftCardRedemptionReclass(input: {
  businessId: string;
  amount: number;
  date: string;
  channel: 'pos' | 'online';
  locationId?: number;
  gateway?: string;
  dedupeKey: string;
  referenceId?: number;
}): Promise<string | null> {
  return syncDeferredLiabilityJournal({
    ...input,
    syncType: 'gift_card_redeem',
    liabilityRole: 'gift_card_liability',
    liabilityLabel: 'Gift card',
    direction: 'redeem',
  });
}

export async function syncStoreCreditIssueReclass(input: {
  businessId: string;
  amount: number;
  date: string;
  channel: 'pos' | 'online';
  locationId?: number;
  gateway?: string;
  dedupeKey: string;
  referenceId?: number;
}): Promise<string | null> {
  return syncDeferredLiabilityJournal({
    ...input,
    syncType: 'store_credit_issue',
    liabilityRole: 'store_credit_liability',
    liabilityLabel: 'Store credit',
    direction: 'issue',
  });
}

export async function syncStoreCreditRedemptionReclass(input: {
  businessId: string;
  amount: number;
  date: string;
  channel: 'pos' | 'online';
  locationId?: number;
  gateway?: string;
  dedupeKey: string;
  referenceId?: number;
}): Promise<string | null> {
  return syncDeferredLiabilityJournal({
    ...input,
    syncType: 'store_credit_redeem',
    liabilityRole: 'store_credit_liability',
    liabilityLabel: 'Store credit',
    direction: 'redeem',
  });
}

// ─── COGS Journals ───────────────────────────────────────────────────────────

export async function syncCogsJournal(input: {
  businessId: string;
  label: string;
  journalDate: string;
  amount: number;
  runKind?: 'original' | 'adjustment';
  locationId?: number;
}): Promise<{ journalId: string; xeroState: string }> {
  const accounts = await getAccountMappings(input.businessId);
  const trackingMappings = await getTrackingMappings(input.businessId);

  if (!accounts.cogs || !accounts.inventory_asset) {
    await logSync(input.businessId, 'cogs_journal', null, null, 'skipped', 'Missing COGS or Inventory Asset account mapping');
    throw new Error('Missing Xero account mappings: cogs and inventory_asset are required');
  }

  const runLabel = input.runKind === 'adjustment' ? 'COGS adjustment' : 'COGS';
  const description = `${runLabel} - ${input.label}`;
  const tracking = getTrackingForLocation(trackingMappings, input.locationId ?? null);
  const journalLines = buildCogsJournalLines({
    amount: input.amount,
    cogsAccountCode: accounts.cogs,
    inventoryAccountCode: accounts.inventory_asset,
    description,
  }).map(line => ({ ...line, Tracking: tracking }));

  if (journalLines.length === 0) throw new Error('Cannot post a zero-value COGS journal');

  const journal = {
    Narration: `${description}${input.locationId ? ` (Location ${input.locationId})` : ''}`,
    Date: input.journalDate,
    JournalLines: journalLines,
  };

  try {
    const result = await xeroApiFetch(input.businessId, '/ManualJournals', {
      method: 'POST',
      body: { ManualJournals: [journal] },
    });
    const posted = result.ManualJournals?.[0];
    const journalId = posted?.ManualJournalID;
    if (!journalId) throw new Error('Xero did not return a ManualJournalID');
    const xeroState = posted?.Status ?? 'POSTED';
    await logSync(
      input.businessId,
      'cogs_journal',
      null,
      journalId,
      'success',
      `${description}: $${Math.abs(input.amount).toFixed(2)}`,
      xeroState,
    );
    return { journalId, xeroState };
  } catch (err: any) {
    await logSync(input.businessId, 'cogs_journal', null, null, 'error', `${description}: ${err.message}`);
    throw err;
  }
}

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
  const [year, monthNumber] = month.split('-').map(Number);
  const journalDate = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const result = await syncCogsJournal({
    businessId,
    label: month,
    journalDate,
    amount: totalCOGS,
    locationId,
  });
  return result.journalId;
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
    cashRounding?: number; // net cash rounding adjustment for the session (Cash only)
    idempotencyKey?: string;
  },
): Promise<{ xeroId: string; invoiceNumber: string; amountDue: number } | null> {
  const accounts         = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);

  const salesAccountCode = accounts.sales_revenue;

  if (!salesAccountCode) {
    await logSync(businessId, 'eod_reconciliation', null, null, 'skipped',
      `No Sales Revenue account mapped for EOD ${entry.date} ${entry.method}`);
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
    LineItems: [
      {
        Description: `${entry.method} Sales — ${entry.locationName}${regLabel}${sessLabel} — ${entry.date}`,
        Quantity:    1,
        UnitAmount:  entry.salesAmount,
        AccountCode: salesAccountCode,
        TaxType:     'OUTPUT',
        Tracking:    tracking,
      },
      // Net cash rounding for the session (positive = customer paid more, negative = less)
      // Posted to dedicated Rounding account if mapped, otherwise falls back to sales_revenue.
      // Tax type NONE: rounding adjustments are not subject to GST.
      ...(entry.cashRounding
        ? [{
            Description: `Cash Rounding Adjustment — ${entry.locationName} — ${entry.date}`,
            Quantity:    1,
            UnitAmount:  entry.cashRounding,
            AccountCode: accounts.rounding ?? salesAccountCode,
            TaxType:     'NONE',
          }]
        : []),
    ],
  };

  try {
    const result        = await xeroApiFetch(businessId, '/Invoices', {
      method: 'POST',
      body: { Invoices: [invoice] },
      idempotencyKey: entry.idempotencyKey,
    });
    const inv           = result.Invoices?.[0];
    const xeroId        = inv?.InvoiceID ?? null;
    const invoiceNumber = inv?.InvoiceNumber ?? '';
    const fallbackAmount = roundCurrency(entry.salesAmount + (entry.cashRounding ?? 0));
    const amountDue = roundCurrency(Number(inv?.AmountDue ?? inv?.Total ?? fallbackAmount));
    return xeroId ? { xeroId, invoiceNumber, amountDue } : null;
  } catch (err: any) {
    await logSync(businessId, 'eod_reconciliation', null, null, 'error',
      `EOD ${entry.date} ${entry.method}: ${err.message}`);
    return null;
  }
}

type EodSyncPersistence = {
  setXeroInvoice: (locationId: number, date: string, method: string, invoiceId: string, clearingAccountCode: string, registerId?: number | null) => Promise<void>;
  setXeroPayment: (locationId: number, date: string, method: string, paymentId: string, clearingAccountCode: string, registerId?: number | null) => Promise<void>;
  setXeroPaymentError: (locationId: number, date: string, method: string, error: string, clearingAccountCode: string, registerId?: number | null) => Promise<void>;
};

export type EodXeroSyncResult = {
  method: string;
  status: 'paid' | 'blocked_missing_mapping' | 'blocked_missing_over_short_mapping' | 'invoice_posted_payment_failed' | 'paid_variance_failed' | 'already_paid' | 'invoice_failed';
  xeroId?: string;
  invoiceNumber?: string;
  error?: string;
};

async function getEodInvoiceAmountDue(businessId: string, xeroId: string, fallback: number): Promise<number> {
  const response = await xeroApiFetch(businessId, `/Invoices/${encodeURIComponent(xeroId)}`);
  const invoice = response?.Invoices?.[0];
  return roundCurrency(Number(invoice?.AmountDue ?? invoice?.Total ?? fallback));
}

async function applyEodClearingPayment(
  businessId: string,
  input: { xeroId: string; date: string; locationId: number; registerId?: number | null; sessionId?: number | null; method: string; clearingAccountCode: string; amount: number; idempotencyKey?: string },
): Promise<string> {
  const registerPart = input.registerId ? ` R${input.registerId}` : '';
  const sessionPart = input.sessionId ? ` S${input.sessionId}` : '';
  const response = await xeroApiFetch(businessId, '/Payments', {
    method: 'POST',
    body: { Payments: [{
      Invoice: { InvoiceID: input.xeroId },
      Account: { Code: input.clearingAccountCode },
      Date: input.date,
      Amount: input.amount,
      Reference: `EOD clearing L${input.locationId}${registerPart}${sessionPart} ${input.method} ${input.date}`,
    }] },
    idempotencyKey: input.idempotencyKey,
  });
  const paymentId = response?.Payments?.[0]?.PaymentID;
  if (!paymentId) throw new Error('Xero did not return a clearing payment ID');
  return paymentId;
}

type CashEodPlan = {
  eod_reconciliation_id: number;
  expected_amount: number;
  counted_amount: number;
  opening_float: number;
  cash_rounding: number;
  sales_amount: number;
  till_variance: number;
  clearing_account_code: string;
  over_short_account_code: string | null;
  invoice_status: string;
  payment_status: string;
  variance_status: string;
  invoice_idempotency_key: string;
  payment_idempotency_key: string;
  variance_idempotency_key: string;
  xero_variance_id: string | null;
};

function cashActionKey(businessId: string, reconciliationId: number, action: string): string {
  return crypto.createHash('sha256').update(`${businessId}|pos-cash-eod|${reconciliationId}|${action}`).digest('hex');
}

async function getOrCreateCashEodPlan(input: {
  businessId: string;
  reconciliationId: number;
  expectedAmount: number;
  countedAmount: number;
  openingFloat: number;
  cashRounding: number;
  clearingAccountCode: string;
  overShortAccountCode: string | null;
}): Promise<CashEodPlan> {
  const existing = await query<CashEodPlan>(
    `SELECT * FROM xero_pos_cash_eod_actions
      WHERE business_id = ? AND eod_reconciliation_id = ? LIMIT 1`,
    [input.businessId, input.reconciliationId],
  );
  if (existing[0]) return existing[0];

  const position = calculateCashPosition({
    expectedAmount: input.expectedAmount,
    countedAmount: input.countedAmount,
    openingFloat: input.openingFloat,
  });
  const split = splitExpectedCashTender({
    expectedAmount: input.expectedAmount,
    cashRounding: input.cashRounding,
  });
  const plan: CashEodPlan = {
    eod_reconciliation_id: input.reconciliationId,
    expected_amount: position.cashTenderExpected,
    counted_amount: input.countedAmount,
    opening_float: input.openingFloat,
    cash_rounding: split.roundingAmount,
    sales_amount: split.salesAmount,
    till_variance: position.tillVariance,
    clearing_account_code: input.clearingAccountCode,
    over_short_account_code: input.overShortAccountCode,
    invoice_status: 'pending',
    payment_status: 'pending',
    variance_status: position.tillVariance === 0 ? 'not_required' : 'pending',
    invoice_idempotency_key: cashActionKey(input.businessId, input.reconciliationId, 'invoice'),
    payment_idempotency_key: cashActionKey(input.businessId, input.reconciliationId, 'payment'),
    variance_idempotency_key: cashActionKey(input.businessId, input.reconciliationId, 'variance'),
    xero_variance_id: null,
  };
  await execute(
    `INSERT INTO xero_pos_cash_eod_actions
       (business_id, eod_reconciliation_id, expected_amount, counted_amount, opening_float,
        cash_rounding, sales_amount, till_variance, clearing_account_code,
        over_short_account_code, variance_status, invoice_idempotency_key,
        payment_idempotency_key, variance_idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.businessId, input.reconciliationId, plan.expected_amount, plan.counted_amount,
      plan.opening_float, plan.cash_rounding, plan.sales_amount, plan.till_variance,
      plan.clearing_account_code, plan.over_short_account_code, plan.variance_status,
      plan.invoice_idempotency_key, plan.payment_idempotency_key, plan.variance_idempotency_key,
    ],
  );
  return plan;
}

async function getCashEodPlan(businessId: string, reconciliationId: number): Promise<CashEodPlan | null> {
  const rows = await query<CashEodPlan>(
    `SELECT * FROM xero_pos_cash_eod_actions
      WHERE business_id = ? AND eod_reconciliation_id = ? LIMIT 1`,
    [businessId, reconciliationId],
  );
  return rows[0] ?? null;
}

async function postCashTillVariance(
  businessId: string,
  input: {
    reconciliationId: number;
    date: string;
    locationName: string;
    clearingAccountCode: string;
    overShortAccountCode: string;
    amount: number;
    tracking: any[];
    idempotencyKey: string;
  },
): Promise<string> {
  const response = await xeroApiFetch(businessId, '/BankTransactions', {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { BankTransactions: [{
      Type: input.amount > 0 ? 'RECEIVE' : 'SPEND',
      Contact: { Name: 'POS Reconciliation (Summary)' },
      BankAccount: { Code: input.clearingAccountCode },
      Date: input.date,
      Reference: `POS till variance ${input.locationName} ${input.date}`,
      LineAmountTypes: 'NoTax',
      LineItems: [{
        Description: `POS cash ${input.amount > 0 ? 'overage' : 'shortage'} — ${input.locationName} — ${input.date}`,
        Quantity: 1,
        UnitAmount: Math.abs(input.amount),
        AccountCode: input.overShortAccountCode,
        TaxType: 'NONE',
        Tracking: input.tracking,
      }],
    }] },
  });
  const id = response?.BankTransactions?.[0]?.BankTransactionID;
  if (!id) throw new Error('Xero did not return a till variance BankTransactionID');
  return String(id);
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
    id?: number;
    payment_method: string;
    expected_amount?: number | null;
    counted_amount: number | null;
    opening_float:  number | null;
    register_session_id?: number | null;
    xero_invoice_id?: string | null;
    xero_payment_required?: number;
    xero_payment_id?: string | null;
  }>,
  locationName: string,
  registerId: number | null,
  persistence: EodSyncPersistence,
  registerName?: string | null,
): Promise<EodXeroSyncResult[]> {
  const results: EodXeroSyncResult[] = [];
  const clearingMappings = await getPosClearingMappings(businessId, locationId);
  const accounts = await getAccountMappings(businessId);
  const tracking = getTrackingForLocation(await getTrackingMappings(businessId), locationId);

  // Sum net cash rounding for the session so we can attach it to the Cash invoice.
  // Positive = customers paid slightly more (round up); negative = slightly less (round down).
  let netCashRounding = 0;
  const cashEodRow = rows.find(r => /cash/i.test(r.payment_method));
  if (cashEodRow) {
    const sessionId = cashEodRow.register_session_id ?? null;
    const roundRows = await imsQuery<{ net_rounding: string }>(
      sessionId
        ? `SELECT COALESCE(SUM(cash_rounding), 0) AS net_rounding
             FROM pos_sales
            WHERE location_id = ? AND register_session_id = ?
              AND status IN ('completed', 'return')`
        : `SELECT COALESCE(SUM(cash_rounding), 0) AS net_rounding
             FROM pos_sales
            WHERE location_id = ? AND DATE(created_at) = ?
              AND status IN ('completed', 'return')`,
      sessionId ? [locationId, sessionId] : [locationId, date],
    );
    netCashRounding = Math.round(Number(roundRows[0]?.net_rounding ?? 0) * 100) / 100;
  }

  for (const row of rows) {
    if (row.counted_amount == null) continue;
    const isCash = /^cash$/i.test(row.payment_method.trim());
    const openFloat = isCash ? (row.opening_float ?? 0) : 0;
    let salesAmount = row.counted_amount - openFloat;
    let cashPlan: CashEodPlan | null = null;
    const clearingAccountCode = clearingMappings[row.payment_method.trim().toLowerCase()];
    if (!clearingAccountCode) {
      const detail = `Missing POS clearing account mapping: ${locationName} / ${row.payment_method}`;
      await logSync(businessId, 'eod_reconciliation', null, null, 'skipped', detail);
      results.push({ method: row.payment_method, status: 'blocked_missing_mapping', error: detail });
      continue;
    }

    if (isCash && row.id != null) {
      cashPlan = await getCashEodPlan(businessId, row.id);
    }
    if (isCash && row.id != null && !cashPlan && !row.xero_invoice_id) {
      const expectedAmount = Number(row.expected_amount ?? 0);
      const tillVariance = calculateCashPosition({
        expectedAmount,
        countedAmount: row.counted_amount,
        openingFloat: openFloat,
      }).tillVariance;
      if (tillVariance !== 0 && !accounts.cash_over_short) {
        const detail = `Missing Cash Over / Short account mapping for ${locationName}`;
        await logSync(businessId, 'eod_reconciliation', row.id, null, 'skipped', detail);
        results.push({ method: row.payment_method, status: 'blocked_missing_over_short_mapping', error: detail });
        continue;
      }
      cashPlan = await getOrCreateCashEodPlan({
        businessId,
        reconciliationId: row.id,
        expectedAmount,
        countedAmount: row.counted_amount,
        openingFloat: openFloat,
        cashRounding: netCashRounding,
        clearingAccountCode,
        overShortAccountCode: accounts.cash_over_short ?? null,
      });
      salesAmount = cashPlan.sales_amount;
    }
    if (cashPlan) salesAmount = Number(cashPlan.sales_amount);
    if (salesAmount <= 0) continue;

    const paymentAlreadyComplete = !!row.xero_payment_id || (!!row.xero_invoice_id && !row.xero_payment_required);
    if (paymentAlreadyComplete && cashPlan && Number(cashPlan.till_variance) !== 0 && cashPlan.variance_status !== 'completed') {
      try {
        const varianceId = await postCashTillVariance(businessId, {
          reconciliationId: cashPlan.eod_reconciliation_id,
          date,
          locationName,
          clearingAccountCode,
          overShortAccountCode: cashPlan.over_short_account_code as string,
          amount: Number(cashPlan.till_variance),
          tracking,
          idempotencyKey: cashPlan.variance_idempotency_key,
        });
        await execute(
          `UPDATE xero_pos_cash_eod_actions
              SET variance_status = 'completed', xero_variance_id = ?, error_detail = NULL,
                  completed_at = NOW(), attempt_count = attempt_count + 1, last_attempt_at = NOW()
            WHERE business_id = ? AND eod_reconciliation_id = ?`,
          [varianceId, businessId, cashPlan.eod_reconciliation_id],
        );
        results.push({ method: row.payment_method, status: 'paid', xeroId: row.xero_invoice_id ?? undefined });
      } catch (error: any) {
        const message = error?.message ?? 'Till variance posting failed';
        await execute(
          `UPDATE xero_pos_cash_eod_actions
              SET variance_status = 'error', error_detail = ?,
                  attempt_count = attempt_count + 1, last_attempt_at = NOW()
            WHERE business_id = ? AND eod_reconciliation_id = ?`,
          [message, businessId, cashPlan.eod_reconciliation_id],
        );
        results.push({ method: row.payment_method, status: 'paid_variance_failed', xeroId: row.xero_invoice_id ?? undefined, error: message });
      }
      continue;
    }
    if (paymentAlreadyComplete) {
      results.push({ method: row.payment_method, status: 'already_paid', xeroId: row.xero_invoice_id ?? undefined });
      continue;
    }

    const cashRounding = cashPlan
      ? (cashPlan.cash_rounding !== 0 ? cashPlan.cash_rounding : undefined)
      : (/cash/i.test(row.payment_method) && netCashRounding !== 0 ? netCashRounding : undefined);
    let xeroId = row.xero_invoice_id ?? null;
    let invoiceNumber = '';
    let amountDue = roundCurrency(salesAmount + (cashRounding ?? 0));

    if (!xeroId) {
      const invoiceResult = await syncEodEntry(businessId, {
        date, locationId, locationName,
        registerId: registerId ?? undefined,
        registerName: registerName ?? undefined,
        sessionId: row.register_session_id ?? undefined,
        method: row.payment_method,
        salesAmount,
        cashRounding,
        idempotencyKey: cashPlan?.invoice_idempotency_key,
      });
      if (!invoiceResult) {
        results.push({ method: row.payment_method, status: 'invoice_failed' });
        continue;
      }
      xeroId = invoiceResult.xeroId;
      invoiceNumber = invoiceResult.invoiceNumber;
      amountDue = invoiceResult.amountDue;
      await persistence.setXeroInvoice(locationId, date, row.payment_method, xeroId, clearingAccountCode, registerId);
      if (cashPlan) {
        await execute(
          `UPDATE xero_pos_cash_eod_actions
              SET invoice_status = 'completed', xero_invoice_id = ?, error_detail = NULL,
                  attempt_count = attempt_count + 1, last_attempt_at = NOW()
            WHERE business_id = ? AND eod_reconciliation_id = ?`,
          [xeroId, businessId, cashPlan.eod_reconciliation_id],
        );
      }
    }
    try {
      if (row.xero_invoice_id) {
        amountDue = await getEodInvoiceAmountDue(businessId, xeroId, amountDue);
      }
      const paymentId = await applyEodClearingPayment(businessId, {
        xeroId,
        date,
        locationId,
        registerId,
        sessionId: row.register_session_id ?? undefined,
        method: row.payment_method,
        clearingAccountCode,
        amount: amountDue,
        idempotencyKey: cashPlan?.payment_idempotency_key,
      });
      await persistence.setXeroPayment(locationId, date, row.payment_method, paymentId, clearingAccountCode, registerId);
      if (cashPlan) {
        await execute(
          `UPDATE xero_pos_cash_eod_actions
              SET payment_status = 'completed', xero_payment_id = ?, error_detail = NULL,
                  attempt_count = attempt_count + 1, last_attempt_at = NOW()
            WHERE business_id = ? AND eod_reconciliation_id = ?`,
          [paymentId, businessId, cashPlan.eod_reconciliation_id],
        );
        if (cashPlan.till_variance !== 0 && cashPlan.variance_status !== 'completed') {
          try {
            const varianceId = await postCashTillVariance(businessId, {
              reconciliationId: cashPlan.eod_reconciliation_id,
              date,
              locationName,
              clearingAccountCode,
              overShortAccountCode: cashPlan.over_short_account_code as string,
              amount: cashPlan.till_variance,
              tracking,
              idempotencyKey: cashPlan.variance_idempotency_key,
            });
            await execute(
              `UPDATE xero_pos_cash_eod_actions
                  SET variance_status = 'completed', xero_variance_id = ?, error_detail = NULL,
                      completed_at = NOW(), attempt_count = attempt_count + 1, last_attempt_at = NOW()
                WHERE business_id = ? AND eod_reconciliation_id = ?`,
              [varianceId, businessId, cashPlan.eod_reconciliation_id],
            );
          } catch (error: any) {
            const message = error?.message ?? 'Till variance posting failed';
            await execute(
              `UPDATE xero_pos_cash_eod_actions
                  SET variance_status = 'error', error_detail = ?,
                      attempt_count = attempt_count + 1, last_attempt_at = NOW()
                WHERE business_id = ? AND eod_reconciliation_id = ?`,
              [message, businessId, cashPlan.eod_reconciliation_id],
            );
            results.push({ method: row.payment_method, status: 'paid_variance_failed', xeroId, invoiceNumber, error: message });
            continue;
          }
        } else if (cashPlan.till_variance === 0) {
          await execute(
            `UPDATE xero_pos_cash_eod_actions
                SET completed_at = NOW(), error_detail = NULL
              WHERE business_id = ? AND eod_reconciliation_id = ?`,
            [businessId, cashPlan.eod_reconciliation_id],
          );
        }
      }
      await logSync(businessId, 'eod_reconciliation', null, xeroId, 'success',
        `EOD ${date} ${row.payment_method} — ${locationName}: $${amountDue.toFixed(2)} paid to ${clearingAccountCode}`,
        'PAID');
      results.push({ method: row.payment_method, status: 'paid', xeroId, invoiceNumber });
    } catch (error: any) {
      const message = error?.message ?? 'Clearing payment failed';
      await persistence.setXeroPaymentError(locationId, date, row.payment_method, message, clearingAccountCode, registerId);
      await logSync(businessId, 'eod_reconciliation', null, xeroId, 'error',
        `Invoice posted; clearing payment pending for ${locationName} / ${row.payment_method}: ${message}`,
        'AUTHORISED');
      results.push({ method: row.payment_method, status: 'invoice_posted_payment_failed', xeroId, invoiceNumber, error: message });
    }
  }

  // Reclass gift card issue value from revenue to liability once per EOD run.
  // Gift card issues are already included in POS sales totals/invoices.
  const registerSessionId = rows.find(r => r.register_session_id != null)?.register_session_id ?? null;
  const giftCardRows = await imsQuery<{ issued_total: string }>(
    registerSessionId
      ? `SELECT COALESCE(SUM(gct.amount), 0) AS issued_total
           FROM gift_card_transactions gct
           JOIN pos_sales ps ON ps.id = gct.pos_sale_id
          WHERE gct.type = 'issue'
            AND ps.location_id = ?
            AND ps.register_session_id = ?
            AND ps.status IN ('completed','layby_complete')`
      : `SELECT COALESCE(SUM(gct.amount), 0) AS issued_total
           FROM gift_card_transactions gct
           JOIN pos_sales ps ON ps.id = gct.pos_sale_id
          WHERE gct.type = 'issue'
            AND ps.location_id = ?
            AND DATE(ps.completed_at) = ?
            AND ps.status IN ('completed','layby_complete')`,
    registerSessionId ? [locationId, registerSessionId] : [locationId, date],
  ).catch(() => [] as { issued_total: string }[]);
  const giftCardIssued = roundCurrency(Number(giftCardRows[0]?.issued_total ?? 0));
  if (giftCardIssued > 0) {
    const key = `gift card liability pos ${date}|L${locationId}${registerSessionId ? `|S${registerSessionId}` : ''}`;
    await syncGiftCardLiabilityReclass({
      businessId,
      amount: giftCardIssued,
      date,
      channel: 'pos',
      locationId,
      dedupeKey: key,
    });
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
  const stored = await imsQuery<{ xero_credit_note_id: string | null }>(
    `SELECT xero_credit_note_id FROM ims_credit_notes WHERE id = ? LIMIT 1`,
    [cn.id],
  );
  if (stored[0]?.xero_credit_note_id) return stored[0].xero_credit_note_id;

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
    Type: 'ACCRECCREDIT',
    Contact: { Name: cn.customer_name || `Customer #${cn.customer_id}` },
    Date: cn.cn_date,
    CreditNoteNumber: cn.cn_number,
    Reference: cn.reference || cn.cn_number,
    Status: 'AUTHORISED',
    LineAmountTypes: lineAmountType,
    LineItems: lineItems,
  };

  const monetaryFingerprint = JSON.stringify({
    totalAmount: Number(cn.total_amount),
    taxTreatment: cn.tax_treatment ?? 'ex_tax',
    items: (cn.items ?? []).map(item => ({
      code: item.code ?? null,
      name: item.name ?? null,
      qty: Number(item.qty),
      unitPrice: Number(item.unit_price),
      taxRate: Number(item.tax_rate),
      lineTotal: Number(item.line_total),
    })),
  });
  try {
    const idempotencyKey = crypto.createHash('sha256')
      .update(`${businessId}|customer-credit-note|${cn.id}|${cn.cn_number}|${monetaryFingerprint}`)
      .digest('hex');
    const result = await xeroApiFetch(businessId, '/CreditNotes', {
      method: 'POST',
      idempotencyKey,
      body: { CreditNotes: [creditNote] },
    });
    const xeroId = result.CreditNotes?.[0]?.CreditNoteID ?? null;
    await logSync(businessId, 'cn_credit_note', cn.id, xeroId, 'success', `Credit note created: ${cn.cn_number}`, result.CreditNotes?.[0]?.Status ?? 'AUTHORISED');
    await markCNXeroStatus(cn.id, 'synced', xeroId);
    return xeroId;
  } catch (err: any) {
    const parsed = parseXeroValidationDetails(err.message);
    if (parsed.duplicateNumber) {
      try {
        const creditNoteNoNumber = { ...creditNote };
        delete creditNoteNoNumber.CreditNoteNumber;
        const retry = await xeroApiFetch(businessId, '/CreditNotes', {
          method: 'POST',
          idempotencyKey: crypto.createHash('sha256')
            .update(`${businessId}|customer-credit-note|${cn.id}|${cn.cn_number}|${monetaryFingerprint}|auto-number`)
            .digest('hex'),
          body: { CreditNotes: [creditNoteNoNumber] },
        });
        const xeroId = retry.CreditNotes?.[0]?.CreditNoteID ?? null;
        await logSync(
          businessId,
          'cn_credit_note',
          cn.id,
          xeroId,
          'success',
          `Credit note created after duplicate-number fallback: ${cn.cn_number}`,
          retry.CreditNotes?.[0]?.Status ?? 'AUTHORISED',
        );
        await markCNXeroStatus(cn.id, 'synced', xeroId);
        return xeroId;
      } catch (retryErr: any) {
        await logSync(businessId, 'cn_credit_note', cn.id, null, 'error', parseXeroValidationDetails(retryErr.message).summary);
        return null;
      }
    }
    await logSync(businessId, 'cn_credit_note', cn.id, null, 'error', parsed.summary);
    return null;
  }
}

// ─── Supplier Credit Notes (ACCPAY) ──────────────────────────────────
interface SupplierCNForSync {
  id: number;
  scn_number: string;
  supplier_id?: number | null;
  supplier_name?: string | null;
  location_id: number;
  scn_date: string;
  reference?: string | null;
  supplier_credit_ref?: string | null;
  tax_treatment?: 'ex_tax' | 'inc_tax' | 'no_tax';
  total_amount: number;
  items?: {
    code?: string | null;
    name?: string | null;
    qty: number;
    unit_cost: number;
    restock?: boolean | number;
    tax_rate: number;
    line_total: number;
  }[];
}

interface SupplierCNFileRow {
  filename: string;
  original_name: string;
  mime_type: string | null;
}

function parseXeroValidationDetails(errMessage: string): { summary: string; duplicateNumber: boolean } {
  const out: string[] = [];
  const msg = String(errMessage || '').trim();
  let duplicateNumber = false;
  try {
    const jsonStart = msg.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(msg.slice(jsonStart));
      const elements = Array.isArray(parsed?.Elements) ? parsed.Elements : [];
      for (const el of elements) {
        const headerErrs = Array.isArray(el?.ValidationErrors) ? el.ValidationErrors : [];
        for (const ve of headerErrs) {
          const m = String(ve?.Message ?? '').trim();
          if (m) out.push(m);
        }
        const lineItems = Array.isArray(el?.LineItems) ? el.LineItems : [];
        for (const li of lineItems) {
          const lineErrs = Array.isArray(li?.ValidationErrors) ? li.ValidationErrors : [];
          for (const ve of lineErrs) {
            const m = String(ve?.Message ?? '').trim();
            if (m) out.push(m);
          }
        }
      }
    }
  } catch {
    // Fall back to raw message when payload is not JSON or cannot be parsed.
  }

  const combined = out.join(' | ') || msg;
  const haystack = combined.toLowerCase();
  duplicateNumber = /invoice number|credit note number|already been used|must be unique|duplicate|credit note not of valid status for modification/.test(haystack);
  return { summary: combined, duplicateNumber };
}

function getSupplierCNUploadDir(businessId: string, scnNumber: string): string {
  const base = process.env.UPLOAD_BASE_PATH ?? './uploads';
  const safeScnNumber = scnNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(base, businessId, 'SCNs', safeScnNumber);
}

export async function syncSupplierCNAttachmentsToXero(
  businessId: string,
  scnId: number,
  scnNumber: string,
  xeroCreditNoteId: string,
  onlyFilenames?: string[],
): Promise<void> {
  let files: SupplierCNFileRow[] = [];
  try {
    if (onlyFilenames?.length) {
      const placeholders = onlyFilenames.map(() => '?').join(', ');
      files = await imsQuery<SupplierCNFileRow>(
        `SELECT filename, original_name, mime_type
           FROM ims_supplier_credit_note_files
          WHERE scn_id = ? AND business_id = ? AND filename IN (${placeholders})
          ORDER BY uploaded_at ASC`,
        [scnId, businessId, ...onlyFilenames],
      );
    } else {
      files = await imsQuery<SupplierCNFileRow>(
        `SELECT filename, original_name, mime_type
           FROM ims_supplier_credit_note_files
          WHERE scn_id = ? AND business_id = ?
          ORDER BY uploaded_at ASC`,
        [scnId, businessId],
      );
    }
  } catch {
    return;
  }
  if (!files.length) return;

  const { accessToken, tenantId } = await getValidAccessToken(businessId);
  const uploadDir = getSupplierCNUploadDir(businessId, scnNumber);

  for (const f of files) {
    const filePath = path.join(uploadDir, f.filename);
    if (!fs.existsSync(filePath)) {
      await logSync(
        businessId,
        'scn_attachment',
        scnId,
        xeroCreditNoteId,
        'skipped',
        `file=${f.filename}; original=${f.original_name || ''}; message=Attachment missing on disk`,
      );
      continue;
    }

    const safeOriginalName = (f.original_name || f.filename).replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const encodedName = encodeURIComponent(safeOriginalName);
    const url = `https://api.xero.com/api.xro/2.0/CreditNotes/${xeroCreditNoteId}/Attachments/${encodedName}`;

    try {
      const buffer = fs.readFileSync(filePath);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'xero-tenant-id': tenantId,
          'Content-Type': f.mime_type || 'application/octet-stream',
          Accept: 'application/json',
        },
        body: buffer,
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 401 && /AuthorizationUnsuccessful/i.test(text)) {
          throw new Error('Xero attachment upload unauthorized. Reconnect Xero to grant the accounting.attachments scope, then retry the file upload.');
        }
        throw new Error(`Xero attachment upload failed (${res.status}): ${text}`);
      }
      await logSync(
        businessId,
        'scn_attachment',
        scnId,
        xeroCreditNoteId,
        'success',
        `file=${f.filename}; original=${safeOriginalName}; message=Attachment uploaded`,
      );
    } catch (err: any) {
      await logSync(
        businessId,
        'scn_attachment',
        scnId,
        xeroCreditNoteId,
        'error',
        `file=${f.filename}; original=${f.original_name || ''}; message=${err.message}`,
      );
    }
  }
}

/** Write Xero sync status back to the supplier credit note row. Silent — never throws. */
export async function markSupplierCNXeroStatus(
  scnId: number,
  status: 'synced' | 'queued' | 'error',
  xeroId?: string | null,
): Promise<void> {
  try {
    await imsExecute(
      `UPDATE ims_supplier_credit_notes
         SET xero_sync_status = ?, xero_synced_at = NOW()
             ${xeroId !== undefined ? ', xero_credit_note_id = ?' : ''}
         WHERE id = ?`,
      xeroId !== undefined ? [status, xeroId, scnId] : [status, scnId],
    );
  } catch { /* non-critical */ }
}

/**
 * Post a DRAFT Xero Credit Note (ACCPAYCREDIT) for a completed supplier credit note.
 * DRAFT is used for broad tenant compatibility (some orgs reject AUTHORISED
 * creation via API). Restock lines (goods returned) post to Inventory Asset
 * (reverses stock value); non-stock lines (rebates/overcharges) post to the
 * supplier_credit_note account (falls back to COGS). Returns the Xero
 * CreditNoteID, or null on failure.
 */
export async function syncSupplierCNAsCreditNote(businessId: string, scn: SupplierCNForSync): Promise<string | null> {
  const stored = await imsQuery<{ xero_credit_note_id: string | null }>(
    `SELECT xero_credit_note_id FROM ims_supplier_credit_notes WHERE id = ? LIMIT 1`,
    [scn.id],
  );
  if (stored[0]?.xero_credit_note_id) return stored[0].xero_credit_note_id;

  const accounts = await getAccountMappings(businessId);
  const trackingMappings = await getTrackingMappings(businessId);
  const taxTypes = getTaxTypes(businessId);

  const restockAccount  = accounts.inventory_asset;
  const nonStockAccount = accounts.supplier_credit_note || accounts.cogs;
  if (!restockAccount && !nonStockAccount) {
    await logSync(businessId, 'scn_credit_note', scn.id, null, 'skipped', 'No inventory_asset / supplier_credit_note / cogs account mapped');
    return null;
  }

  const tracking = getTrackingForLocation(trackingMappings, scn.location_id, 'wholesale');
  const lineAmountType = scn.tax_treatment === 'inc_tax' ? 'Inclusive' : 'Exclusive';

  const lineItems = (scn.items ?? []).map(item => {
    const restock = item.restock === undefined || item.restock === null ? true : !!Number(item.restock);
    const acct = restock ? (restockAccount || nonStockAccount) : (nonStockAccount || restockAccount);
    const taxed = Number(item.tax_rate) > 0 && scn.tax_treatment !== 'no_tax';
    return {
      Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Supplier credit',
      Quantity: item.qty,
      UnitAmount: item.unit_cost,
      AccountCode: acct,
      TaxType: taxed ? taxTypes.purchases : taxTypes.exempt,
      Tracking: tracking,
    };
  });

  if (!lineItems.length) {
    await logSync(businessId, 'scn_credit_note', scn.id, null, 'skipped', 'No line items');
    return null;
  }

  const creditNoteBase: any = {
    Type: 'ACCPAYCREDIT',
    Contact: { Name: scn.supplier_name || `Supplier #${scn.supplier_id}` },
    Date: scn.scn_date,
    CreditNoteNumber: scn.scn_number,
    Reference: scn.supplier_credit_ref || scn.reference || scn.scn_number,
    Status: 'DRAFT',
    LineAmountTypes: lineAmountType,
    LineItems: lineItems,
  };

  try {
    const idempotencyKey = crypto.createHash('sha256')
      .update(`${businessId}|supplier-credit-note|${scn.id}|${scn.scn_number}`)
      .digest('hex');
    const result = await xeroApiFetch(businessId, '/CreditNotes', {
      method: 'POST',
      idempotencyKey,
      body: { CreditNotes: [creditNoteBase] },
    });
    const xeroId = result.CreditNotes?.[0]?.CreditNoteID ?? null;
    if (xeroId) {
      await syncSupplierCNAttachmentsToXero(businessId, scn.id, scn.scn_number, xeroId);
    }
    await logSync(businessId, 'scn_credit_note', scn.id, xeroId, 'success', `Supplier credit note created: ${scn.scn_number}`, result.CreditNotes?.[0]?.Status ?? 'DRAFT');
    await markSupplierCNXeroStatus(scn.id, 'synced', xeroId);
    return xeroId;
  } catch (err: any) {
    const parsed = parseXeroValidationDetails(err.message);

    // Common Xero case: duplicate invoice/credit note number. Retry once with no
    // explicit CreditNoteNumber so Xero can auto-assign a unique number.
    if (parsed.duplicateNumber) {
      try {
        const creditNoteNoNumber = { ...creditNoteBase };
        delete creditNoteNoNumber.CreditNoteNumber;
        const retry = await xeroApiFetch(businessId, '/CreditNotes', {
          method: 'POST',
          idempotencyKey: crypto.createHash('sha256')
            .update(`${businessId}|supplier-credit-note|${scn.id}|${scn.scn_number}|auto-number`)
            .digest('hex'),
          body: { CreditNotes: [creditNoteNoNumber] },
        });
        const xeroId = retry.CreditNotes?.[0]?.CreditNoteID ?? null;
        if (xeroId) {
          await syncSupplierCNAttachmentsToXero(businessId, scn.id, scn.scn_number, xeroId);
        }
        await logSync(
          businessId,
          'scn_credit_note',
          scn.id,
          xeroId,
          'success',
          `Supplier credit note created after duplicate-number fallback: ${scn.scn_number}`,
          retry.CreditNotes?.[0]?.Status ?? 'DRAFT',
        );
        await markSupplierCNXeroStatus(scn.id, 'synced', xeroId);
        return xeroId;
      } catch (retryErr: any) {
        const retryParsed = parseXeroValidationDetails(retryErr.message);
        await logSync(businessId, 'scn_credit_note', scn.id, null, 'error', `Primary: ${parsed.summary} | Retry: ${retryParsed.summary}`);
        return null;
      }
    }

    await logSync(businessId, 'scn_credit_note', scn.id, null, 'error', parsed.summary);
    return null;
  }
}
