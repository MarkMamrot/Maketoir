import { NextRequest, NextResponse } from 'next/server';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { executeShopifyPayoutActions } from '@/lib/ims/shopifyPayoutActionExecutor';
import { planShopifyPayoutActions } from '@/lib/ims/shopifyPayoutActionPlanner';
import {
  fetchPaidShopifyPayouts,
  getShopifyApiCreds,
  ingestShopifyPayout,
} from '@/lib/ims/shopifyPayoutIngestion';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { assertXeroWorkflowEnabled, isXeroPolicyDisabledError } from '@/lib/xero/postingPolicy';
import { query } from '@/services/MySQLService';

type LinkedPayout = {
  shopify_payout_id: string;
  reconciliation_status: string;
  error_detail: string | null;
  updated_at: string | null;
  reconciled_at: string | null;
};

function validateBatchDate(batchDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(batchDate);
}

function auth(req: NextRequest) {
  const session = requireAdminSession();
  if (session.response) return { response: session.response, businessId: '' };
  const businessId = req.nextUrl.searchParams.get('databaseId') ?? session.user!.businessId;
  const denied = assertBusinessAccess(session.user!, businessId);
  return { response: denied, businessId };
}

async function getOnlineBatchMeta(businessId: string, batchDate: string): Promise<{
  xero_invoice_id: string | null;
  payout_managed: boolean;
}> {
  const rows = await query<any>(
    `SELECT xero_invoice_id, payout_managed
       FROM xero_online_batches
      WHERE business_id = ? AND batch_date = ?
      LIMIT 1`,
    [businessId, batchDate],
  );
  const row = rows[0];
  return {
    xero_invoice_id: row?.xero_invoice_id ? String(row.xero_invoice_id) : null,
    payout_managed: Number(row?.payout_managed ?? 0) === 1,
  };
}

const statusPriority: Record<string, number> = {
  partial: 0,
  planned: 1,
  ready_to_allocate: 2,
  ingesting: 3,
  waiting_for_paid: 4,
  blocked: 5,
  reconciled: 6,
};

async function findLinkedPayoutByInvoice(businessId: string, xeroInvoiceId: string): Promise<LinkedPayout | null> {
  const rows = await query<any>(
    `SELECT p.shopify_payout_id, p.reconciliation_status, p.error_detail, p.updated_at, p.reconciled_at
       FROM shopify_payment_xero_actions a
       JOIN shopify_payment_payouts p
         ON p.business_id = a.business_id
        AND p.shopify_payout_id = a.shopify_payout_id
      WHERE a.business_id = ?
        AND a.action_type = 'invoice_payment'
        AND a.target_xero_document_id = ?
      GROUP BY p.shopify_payout_id, p.reconciliation_status, p.error_detail, p.updated_at, p.reconciled_at`,
    [businessId, xeroInvoiceId],
  );
  if (!rows.length) return null;

  rows.sort((a: any, b: any) => {
    const sa = String(a.reconciliation_status ?? '').toLowerCase();
    const sb = String(b.reconciliation_status ?? '').toLowerCase();
    const pa = statusPriority[sa] ?? 99;
    const pb = statusPriority[sb] ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = new Date(a.reconciled_at ?? a.updated_at ?? 0).getTime();
    const tb = new Date(b.reconciled_at ?? b.updated_at ?? 0).getTime();
    return tb - ta;
  });

  return rows[0] as LinkedPayout;
}

function dayLookbackMin(batchDate: string): string {
  const date = new Date(`${batchDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10);
}

async function discoverPayoutForBatch(businessId: string, batchDate: string): Promise<{
  discovered: number;
  processed: number;
  failed: number;
  payout: LinkedPayout | null;
  invoiceId: string | null;
}> {
  const meta = await getOnlineBatchMeta(businessId, batchDate);
  if (!meta.payout_managed || !meta.xero_invoice_id) {
    return {
      discovered: 0,
      processed: 0,
      failed: 0,
      payout: null,
      invoiceId: meta.xero_invoice_id,
    };
  }

  let payout = await findLinkedPayoutByInvoice(businessId, meta.xero_invoice_id);
  if (payout) {
    return {
      discovered: 0,
      processed: 0,
      failed: 0,
      payout,
      invoiceId: meta.xero_invoice_id,
    };
  }

  const creds = await getShopifyApiCreds(businessId);
  if (!creds) {
    throw new Error('Shopify credentials are unavailable. Configure Shopify connection first.');
  }

  let discovered = 0;
  let processed = 0;
  let failed = 0;

  await runImsForBusiness(businessId, async () => {
    const payouts = await fetchPaidShopifyPayouts(creds, dayLookbackMin(batchDate));
    discovered = payouts.length;
    for (const payoutPayload of payouts) {
      try {
        await ingestShopifyPayout(businessId, payoutPayload, creds);
        processed += 1;
      } catch {
        failed += 1;
      }
    }
  });

  payout = await findLinkedPayoutByInvoice(businessId, meta.xero_invoice_id);
  return {
    discovered,
    processed,
    failed,
    payout,
    invoiceId: meta.xero_invoice_id,
  };
}

export async function POST(req: NextRequest, { params }: { params: { batchDate: string } }) {
  const authn = auth(req);
  if (authn.response) return authn.response;

  const batchDate = String(params.batchDate ?? '').trim();
  if (!validateBatchDate(batchDate)) {
    return NextResponse.json({ error: 'batchDate must be YYYY-MM-DD.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? 'sync').toLowerCase();
  if (!['sync', 'process'].includes(action)) {
    return NextResponse.json({ error: 'action must be sync or process.' }, { status: 400 });
  }

  const meta = await getOnlineBatchMeta(authn.businessId, batchDate);
  if (!meta.payout_managed) {
    return NextResponse.json({
      success: false,
      settlementStatus: 'not_applicable',
      message: 'Shopify payout settlement is not enabled for this online batch.',
    }, { status: 409 });
  }
  if (!meta.xero_invoice_id) {
    return NextResponse.json({
      success: false,
      settlementStatus: 'waiting_batch_sync',
      message: 'Online batch invoice has not been posted to Xero yet. Sync the daily online batch first.',
    }, { status: 409 });
  }

  const discovery = await discoverPayoutForBatch(authn.businessId, batchDate);
  if (!discovery.payout) {
    return NextResponse.json({
      success: false,
      settlementStatus: 'not_found',
      message: 'No paid Shopify payout linked to this daily online invoice yet.',
      search: {
        discovered: discovery.discovered,
        processed: discovery.processed,
        failed: discovery.failed,
      },
    }, { status: 404 });
  }

  const payoutId = String(discovery.payout.shopify_payout_id);
  const payoutStatus = String(discovery.payout.reconciliation_status ?? '').toLowerCase();

  if (action === 'sync') {
    return NextResponse.json({
      success: payoutStatus === 'reconciled',
      settlementStatus: payoutStatus === 'reconciled' ? 'success' : 'non_success',
      payoutId,
      payoutStatus,
      message: payoutStatus === 'reconciled'
        ? `Payout ${payoutId} is already reconciled.`
        : `Payout ${payoutId} found with status ${payoutStatus}.`,
      search: {
        discovered: discovery.discovered,
        processed: discovery.processed,
        failed: discovery.failed,
      },
    });
  }

  let effectiveStatus = payoutStatus;
  if (['blocked', 'ready_to_allocate', 'ingesting', 'waiting_for_paid'].includes(effectiveStatus)) {
    const plan = await runImsForBusiness(authn.businessId, () =>
      planShopifyPayoutActions(authn.businessId, payoutId),
    );
    if (plan.status === 'blocked') {
      return NextResponse.json({
        success: false,
        settlementStatus: 'non_success',
        payoutId,
        payoutStatus: 'blocked',
        message: plan.error || `Payout ${payoutId} is blocked and could not be replanned.`,
      }, { status: 409 });
    }
    effectiveStatus = 'planned';
  }

  if (effectiveStatus === 'reconciled') {
    return NextResponse.json({
      success: true,
      settlementStatus: 'success',
      payoutId,
      payoutStatus: 'reconciled',
      message: `Payout ${payoutId} is already reconciled.`,
    });
  }

  try {
    await assertXeroWorkflowEnabled(authn.businessId, 'shopifyPayoutPostingEnabled');
    const exec = await executeShopifyPayoutActions(authn.businessId, payoutId);
    return NextResponse.json({
      success: exec.status === 'reconciled',
      settlementStatus: exec.status === 'reconciled' ? 'success' : 'non_success',
      payoutId,
      payoutStatus: exec.status,
      completedActionIds: exec.completedActionIds,
      message: exec.status === 'reconciled'
        ? `Payout ${payoutId} processed and reconciled.`
        : exec.error || `Payout ${payoutId} processed with status ${exec.status}.`,
    }, { status: exec.status === 'reconciled' ? 200 : 409 });
  } catch (error) {
    if (isXeroPolicyDisabledError(error)) {
      return NextResponse.json({
        success: false,
        settlementStatus: 'paused',
        payoutId,
        payoutStatus: effectiveStatus,
        code: error.code,
        message: error.message,
      }, { status: error.status });
    }
    throw error;
  }
}
