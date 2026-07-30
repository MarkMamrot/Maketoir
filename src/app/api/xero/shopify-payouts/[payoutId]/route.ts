import { NextRequest, NextResponse } from 'next/server';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { executeShopifyPayoutActions } from '@/lib/ims/shopifyPayoutActionExecutor';
import { planShopifyPayoutActions } from '@/lib/ims/shopifyPayoutActionPlanner';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { syncOnlineDailySalesDay } from '@/lib/xero/onlineDailySalesSync';
import { query } from '@/services/MySQLService';

function authenticate(req: NextRequest) {
  const auth = requireAdminSession();
  if (auth.response) return { response: auth.response, businessId: '' };
  const businessId = req.nextUrl.searchParams.get('databaseId') ?? auth.user!.businessId;
  const denied = assertBusinessAccess(auth.user!, businessId);
  return { response: denied, businessId };
}

export async function GET(req: NextRequest, { params }: { params: { payoutId: string } }) {
  const auth = authenticate(req);
  if (auth.response) return auth.response;

  const payoutRows = await query(
    `SELECT shopify_payout_id, payout_date, shopify_status, currency, payout_amount,
            transaction_net_total, reconciliation_status, error_detail, reconciled_at,
            created_at, updated_at
       FROM shopify_payment_payouts
      WHERE business_id = ? AND shopify_payout_id = ?
      LIMIT 1`,
    [auth.businessId, params.payoutId],
  );
  if (payoutRows.length === 0) {
    return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
  }
  const actions = await query(
    `SELECT id, action_key, action_type, target_xero_document_id, action_date, amount,
            currency, account_code, offset_account_code, tax_type, reference, status,
            xero_id, transaction_ids, error_detail, attempt_count, last_attempt_at, completed_at
       FROM shopify_payment_xero_actions
      WHERE business_id = ? AND shopify_payout_id = ?
      ORDER BY id`,
    [auth.businessId, params.payoutId],
  );
  const transactions = await query(
    `SELECT shopify_transaction_id, transaction_type, amount, fee, net, currency,
            source_order_id, processed_at, business_date
       FROM shopify_payment_payout_transactions
      WHERE business_id = ? AND shopify_payout_id = ?
      ORDER BY processed_at, shopify_transaction_id`,
    [auth.businessId, params.payoutId],
  );

  return NextResponse.json({ payout: payoutRows[0], actions, transactions });
}

export async function POST(req: NextRequest, { params }: { params: { payoutId: string } }) {
  const auth = authenticate(req);
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? 'plan');

  if (action === 'plan') {
    const result = await runImsForBusiness(auth.businessId, () =>
      planShopifyPayoutActions(auth.businessId, params.payoutId),
    );
    return NextResponse.json(result, { status: result.status === 'blocked' ? 409 : 200 });
  }
  if (action === 'execute') {
    const result = await executeShopifyPayoutActions(auth.businessId, params.payoutId);
    return NextResponse.json(result, { status: result.status === 'reconciled' ? 200 : 409 });
  }
  if (action === 'repair') {
    const payoutRows = await query<any>(
      `SELECT p.reconciliation_status,
              SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed_actions
         FROM shopify_payment_payouts p
         LEFT JOIN shopify_payment_xero_actions a
           ON a.business_id = p.business_id
          AND a.shopify_payout_id = p.shopify_payout_id
        WHERE p.business_id = ? AND p.shopify_payout_id = ?
        GROUP BY p.reconciliation_status`,
      [auth.businessId, params.payoutId],
    );
    const payout = payoutRows[0];
    if (!payout) return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    if (String(payout.reconciliation_status).toLowerCase() !== 'blocked') {
      return NextResponse.json({ error: 'Only blocked payouts can be validated and repaired' }, { status: 409 });
    }
    if (Number(payout.completed_actions ?? 0) > 0) {
      return NextResponse.json({ error: 'This payout already has completed Xero actions; automatic invoice repair is blocked' }, { status: 409 });
    }

    const batchRows = await query<any>(
      `SELECT DISTINCT DATE_FORMAT(b.batch_date, '%Y-%m-%d') AS batch_date
         FROM shopify_payment_xero_actions a
         JOIN xero_online_batches b
           ON b.business_id = a.business_id
          AND b.xero_invoice_id = a.target_xero_document_id
        WHERE a.business_id = ? AND a.shopify_payout_id = ?
          AND a.action_type = 'invoice_payment'
        ORDER BY batch_date`,
      [auth.businessId, params.payoutId],
    );
    const dates = batchRows.map(row => String(row.batch_date)).filter(Boolean);
    if (dates.length === 0) {
      return NextResponse.json({ error: 'No linked online daily invoices were found for this payout' }, { status: 409 });
    }

    const refreshed = [];
    for (const date of dates) {
      const result = await syncOnlineDailySalesDay(auth.businessId, date);
      refreshed.push({ date, xeroId: result.xeroId, totalSales: result.totalSales, orderCount: result.orderCount });
    }
    const plan = await runImsForBusiness(auth.businessId, () =>
      planShopifyPayoutActions(auth.businessId, params.payoutId),
    );
    return NextResponse.json({ status: plan.status, error: plan.error, refreshed, actions: plan.actions }, {
      status: plan.status === 'blocked' ? 409 : 200,
    });
  }

  return NextResponse.json({ error: 'action must be plan, repair, or execute' }, { status: 400 });
}