/**
 * GET /api/ims/shopify/payouts-test
 *
 * PHASE C — diagnostic only. Read-only probe of the Shopify Payments payouts
 * API to confirm payout cadence/timing and the shape of the fee/refund data
 * before we build the Xero payout posting.
 *
 * Requires the `read_shopify_payments_payouts` scope on the Shopify app.
 *
 * Query params:
 *   - limit   : number of payouts to list (default 10)
 *   - breakdown : if '1', also fetch balance transactions for the most recent
 *                 payout so we can see the per-order charge/fee/refund split.
 *
 * Auth: authenticated IMS session.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyForBusiness } from '@/lib/ims/shopifyInventorySync';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TZ = 'Australia/Sydney';


/** Format a Shopify timestamp in the business timezone for readability. */
function local(ts: string | null | undefined): string {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: TZ, dateStyle: 'medium', timeStyle: 'short', hour12: true,
    }).format(new Date(ts));
  } catch { return String(ts); }
}

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 50);
  const wantBreakdown = url.searchParams.get('breakdown') === '1';

  const shopify = await getShopifyForBusiness(businessId);
  if (!shopify) return NextResponse.json({ error: 'Shopify not connected' }, { status: 400 });

  try {
    const payouts = await shopify.listPayouts({ limit });

    // Derive the time-of-day pattern (in business tz) from payout dates.
    const times = payouts.map((p: any) => {
      const d = new Date(p.date);
      const hhmm = new Intl.DateTimeFormat('en-AU', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short' }).format(d);
      return { date: p.date, localTimeOfDay: hhmm, localWeekday: weekday };
    });

    const summary = payouts.map((p: any) => ({
      id: p.id,
      date: p.date,
      dateLocal: local(p.date),
      status: p.status,
      currency: p.currency,
      amount: p.amount,
      summary: p.summary, // { adjustments_fee_amount, charges_fee_amount, charges_gross_amount, refunds_fee_amount, refunds_gross_amount, reserved_funds_fee_amount, ... }
    }));

    let breakdown: any = null;
    if (wantBreakdown && payouts.length) {
      const payoutId = payouts[0].id;
      const txns = await shopify.listBalanceTransactions({ payout_id: payoutId });
      breakdown = {
        payoutId,
        payoutDateLocal: local(payouts[0].date),
        transactionCount: txns.length,
        transactions: txns.slice(0, 25).map((t: any) => ({
          id: t.id,
          type: t.type,                  // charge | refund | dispute | adjustment | payout | fee
          amount: t.amount,
          fee: t.fee,
          net: t.net,
          sourceType: t.source_type,     // 'charge' -> an order
          sourceId: t.source_id,
          sourceOrderId: t.source_order_id,
          sourceOrderTransactionId: t.source_order_transaction_id,
          currency: t.currency,
        })),
      };
    }

    return NextResponse.json({
      success: true,
      count: payouts.length,
      note: 'Look at times[].localTimeOfDay to confirm the daily payout time in Australia/Sydney.',
      times,
      payouts: summary,
      breakdown,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const scopeHint = /403|scope|permission|access denied/i.test(msg)
      ? ' — check the app has the read_shopify_payments_payouts scope and that Shopify Payments is enabled.'
      : '';
    return NextResponse.json({ success: false, error: msg + scopeHint }, { status: 500 });
  }
}
