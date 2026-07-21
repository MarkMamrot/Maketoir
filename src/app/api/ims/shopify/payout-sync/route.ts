/**
 * POST /api/ims/shopify/payout-sync
 *
 * PHASE C — posts confirmed Shopify Payments payouts to Xero (cash basis).
 * For each business with payout sync enabled:
 *   1. fetch newly PAID payouts from Shopify (since the last synced payout),
 *   2. pull the per-order balance-transaction breakdown (for reconcile links),
 *   3. resolve GST from the matching IMS sales orders,
 *   4. post one ACCREC invoice per payout whose total = the bank deposit,
 *      with a payment into the Shopify clearing account,
 *   5. store the payout + its order lines for the reconcile report.
 *
 * Idempotent: a payout that already has a xero_id is skipped.
 *
 * Auth: x-cron-secret header (cron, all businesses) OR an IMS session (manual,
 * current business only — accepts { businessId } implicitly from the session).
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getShopifyForBusiness } from '@/lib/ims/shopifyInventorySync';
import { syncShopifyPayout, type ShopifyPayoutSync } from '@/services/XeroSyncService';

export const runtime = 'nodejs';
export const maxDuration = 300;


async function getSetting(businessId: string, key: string): Promise<string> {
  const rows = await imsQuery<{ value: string }>(
    'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [businessId, key],
  );
  return rows[0]?.value ?? '';
}

const num = (v: any) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface PayoutResult { businessId: string; payoutId: number; date: string; posted: boolean; skipped?: string; error?: string; xeroId?: string | null; }

async function processBusiness(businessId: string, lookbackDays: number): Promise<PayoutResult[]> {
  const out: PayoutResult[] = [];

  const enabled = (await getSetting(businessId, 'shopify_payments_payout_sync_enabled')) === '1';
  if (!enabled) return out;
  const basis = (await getSetting(businessId, 'shopify_revenue_basis')) || 'cash';
  if (basis !== 'cash') return out; // accrual uses the legacy daily batch for now

  const shopify = await getShopifyForBusiness(businessId);
  if (!shopify) return out;

  // Resume from the day after the most recent already-synced payout.
  const last = await imsQuery<{ d: string }>(
    'SELECT MAX(payout_date) AS d FROM ims_shopify_payouts WHERE business_id = ? AND xero_id IS NOT NULL',
    [businessId],
  ).catch(() => [] as { d: string }[]);
  const sinceDate = last[0]?.d
    ? new Date(last[0].d)
    : new Date(Date.now() - lookbackDays * 86400000);
  const dateMin = sinceDate.toISOString().slice(0, 10);

  let payouts: any[] = [];
  try {
    payouts = await shopify.listPayouts({ status: 'paid', date_min: dateMin, limit: 50 });
  } catch (e: any) {
    out.push({ businessId, payoutId: 0, date: dateMin, posted: false, error: `listPayouts: ${e.message}` });
    return out;
  }

  for (const payout of payouts) {
    const payoutId = Number(payout.id);
    const date = String(payout.date).slice(0, 10);

    // Idempotency — already posted?
    const existing = await imsQuery<{ xero_id: string | null }>(
      'SELECT xero_id FROM ims_shopify_payouts WHERE business_id = ? AND shopify_payout_id = ? LIMIT 1',
      [businessId, payoutId],
    ).catch(() => [] as { xero_id: string | null }[]);
    if (existing[0]?.xero_id) { out.push({ businessId, payoutId, date, posted: false, skipped: 'already synced' }); continue; }

    const s = payout.summary ?? {};
    const chargesGross = num(s.charges_gross_amount);
    const refundsGross = num(s.refunds_gross_amount);
    const totalFees = round2(num(s.charges_fee_amount) + num(s.refunds_fee_amount) + num(s.adjustments_fee_amount) + num(s.reserved_funds_fee_amount) + num(s.retried_payouts_fee_amount));
    const adjustmentsGross = round2(num(s.adjustments_gross_amount) + num(s.reserved_funds_gross_amount) + num(s.retried_payouts_gross_amount));
    const netAmount = round2(num(payout.amount));
    const netInclTax = round2(chargesGross - refundsGross);

    // Per-order breakdown for reconcile + GST resolution.
    let txns: any[] = [];
    try { txns = await shopify.listBalanceTransactions({ payout_id: payoutId }); }
    catch (e: any) { out.push({ businessId, payoutId, date, posted: false, error: `balanceTxns: ${e.message}` }); continue; }

    const chargeOrderIds = txns.filter(t => t.type === 'charge' && t.source_order_id).map(t => String(t.source_order_id));
    const refundOrderIds = txns.filter(t => t.type === 'refund' && t.source_order_id).map(t => String(t.source_order_id));

    // GST from IMS: charge tax from orders, refund tax from refund records; fall back to /11 (AU GST-inclusive) when unmatched.
    let chargeTax = 0, refundTax = 0, orderCount = chargeOrderIds.length;
    const soByShopId = new Map<string, string>();
    if (chargeOrderIds.length) {
      const ph = chargeOrderIds.map(() => '?').join(',');
      const rows = await imsQuery<{ shopify_order_id: string; so_id: string; tax_amount: number }>(
        `SELECT shopify_order_id, id AS so_id, tax_amount FROM ims_sales_orders WHERE business_id = ? AND shopify_order_id IN (${ph})`,
        [businessId, ...chargeOrderIds],
      ).catch(() => [] as any[]);
      const matched = new Set<string>();
      for (const r of rows) { chargeTax += num(r.tax_amount); matched.add(String(r.shopify_order_id)); soByShopId.set(String(r.shopify_order_id), r.so_id); }
      for (const oid of chargeOrderIds) if (!matched.has(oid)) {
        const t = txns.find(x => String(x.source_order_id) === oid && x.type === 'charge');
        chargeTax += num(t?.amount) / 11; // AU GST-inclusive estimate for orders not in IMS
      }
    }
    if (refundOrderIds.length) {
      const ph = refundOrderIds.map(() => '?').join(',');
      const rows = await imsQuery<{ shopify_order_id: string; tax_amount: number }>(
        `SELECT so.shopify_order_id, cn.tax_amount
           FROM ims_credit_notes cn JOIN ims_sales_orders so ON so.id = cn.so_id
          WHERE cn.business_id = ? AND cn.source = 'shopify' AND so.shopify_order_id IN (${ph})`,
        [businessId, ...refundOrderIds],
      ).catch(() => [] as any[]);
      const matched = new Set<string>();
      for (const r of rows) { refundTax += num(r.tax_amount); matched.add(String(r.shopify_order_id)); }
      for (const oid of refundOrderIds) if (!matched.has(oid)) {
        const t = txns.find(x => String(x.source_order_id) === oid && x.type === 'refund');
        refundTax += Math.abs(num(t?.amount)) / 11;
      }
    }
    const totalTax = round2(chargeTax - refundTax);

    // Store the payout + lines (upsert) BEFORE posting so a failed post can be retried.
    await imsExecute(
      `INSERT INTO ims_shopify_payouts
         (business_id, shopify_payout_id, payout_date, status, currency, charges_gross, charges_fee, refunds_gross, refunds_fee, adjustments_gross, adjustments_fee, net_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), net_amount=VALUES(net_amount)`,
      [businessId, payoutId, date, String(payout.status), String(payout.currency || 'AUD'),
       round2(chargesGross), round2(num(s.charges_fee_amount)), round2(refundsGross), round2(num(s.refunds_fee_amount)),
       adjustmentsGross, round2(num(s.adjustments_fee_amount)), netAmount],
    ).catch(() => {});

    for (const t of txns) {
      if (t.type === 'payout') continue;
      const oid = t.source_order_id ? String(t.source_order_id) : null;
      await imsExecute(
        `INSERT INTO ims_shopify_payout_lines
           (business_id, shopify_payout_id, balance_txn_id, type, amount, fee, net, source_type, source_id, source_order_id, so_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE amount=VALUES(amount), fee=VALUES(fee), net=VALUES(net), so_id=VALUES(so_id)`,
        [businessId, payoutId, Number(t.id), String(t.type), round2(num(t.amount)), round2(num(t.fee)), round2(num(t.net)),
         t.source_type ?? null, t.source_id ?? null, oid, oid ? (soByShopId.get(oid) ?? null) : null],
      ).catch(() => {});
    }

    const payload: ShopifyPayoutSync = { payoutId, date, currency: String(payout.currency || 'AUD'), netInclTax, totalTax, totalFees, adjustmentsGross, netAmount, orderCount };
    try {
      const xeroId = await syncShopifyPayout(businessId, payload);
      if (xeroId) {
        await imsExecute('UPDATE ims_shopify_payouts SET xero_id = ?, xero_status = ?, synced_at = NOW() WHERE business_id = ? AND shopify_payout_id = ?',
          [xeroId, 'AUTHORISED', businessId, payoutId]).catch(() => {});
        out.push({ businessId, payoutId, date, posted: true, xeroId });
      } else {
        out.push({ businessId, payoutId, date, posted: false, skipped: 'not posted (check mappings)' });
      }
    } catch (e: any) {
      out.push({ businessId, payoutId, date, posted: false, error: e.message });
    }
  }

  return out;
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  const isCron = !!secret && secret === process.env.CRON_SECRET;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lookbackDays = Math.min(Number(body?.lookbackDays) || 14, 60);

  let businessIds: string[];
  if (isCron) {
    // Discover businesses from the MAIN registry (not one tenant schema) —
    // processBusiness() checks the enable flag inside each tenant's own DB.
    const bids = await query<{ business_id: string }>(
      'SELECT business_id FROM businesses WHERE deleted_at IS NULL',
    ).catch(() => [] as any[]);
    businessIds = bids.map(r => r.business_id);
  } else {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    businessIds = [session.businessId as string];
  }

  const results: PayoutResult[] = [];
  for (const bid of businessIds) {
    try { results.push(...await runImsForBusiness(bid, () => processBusiness(bid, lookbackDays))); }
    catch (e: any) { results.push({ businessId: bid, payoutId: 0, date: '', posted: false, error: e.message }); }
  }

  return NextResponse.json({ ok: true, posted: results.filter(r => r.posted).length, results });
}
