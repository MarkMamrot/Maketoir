import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import {
  fetchPaidShopifyPayouts,
  getShopifyApiCreds,
  ingestShopifyPayout,
} from '@/lib/ims/shopifyPayoutIngestion';
import { query } from '@/services/MySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { autoPostShopifyPayout } from '@/lib/ims/shopifyPayoutAutoPost';

export const runtime = 'nodejs';
export const maxDuration = 300;

function catchupDateMin(): string {
  const configured = Number(process.env.SHOPIFY_PAYOUT_CATCHUP_DAYS ?? 14);
  const days = Math.min(90, Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 14));
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const businesses = await query<{ business_id: string }>(
    `SELECT b.business_id
       FROM businesses b
       JOIN connections c ON c.business_id = b.business_id
      WHERE b.deleted_at IS NULL
        AND COALESCE(b.automation_paused, 0) = 0
        AND c.shopify_shop_id IS NOT NULL AND c.shopify_shop_id != ''
        AND c.shopify_access_token IS NOT NULL AND c.shopify_access_token != ''
      ORDER BY b.business_id`,
    [],
  );
  const dateMin = catchupDateMin();
  const results: Array<{
    businessId: string;
    discovered: number;
    processed: number;
    failed: number;
    error?: string;
  }> = [];

  for (const { business_id: businessId } of businesses) {
    try {
      const result = await runImsForBusiness(businessId, async () => {
        const creds = await getShopifyApiCreds(businessId);
        if (!creds) throw new Error('Shopify credentials are unavailable');
        const payouts = await fetchPaidShopifyPayouts(creds, dateMin);
        let processed = 0;
        let failed = 0;
        for (const payout of payouts) {
          try {
            await ingestShopifyPayout(businessId, payout, creds);
            await autoPostShopifyPayout(businessId, String(payout?.id ?? ''));
            processed += 1;
          } catch (error) {
            failed += 1;
            const payoutId = String(payout?.id ?? 'unknown');
            console.error(`[shopify-payout-catchup] ${businessId} payout ${payoutId}:`, error);
            await reportRuntimeIssue({
              businessId,
              source: 'shopify',
              operation: 'payout_catchup_ingest',
              title: 'Shopify payout catch-up failed',
              error,
              context: { date_min: dateMin },
              reference: { type: 'shopify_payout', id: payoutId },
            });
          }
        }
        return { businessId, discovered: payouts.length, processed, failed };
      });
      results.push(result);
    } catch (error: any) {
      await reportRuntimeIssue({
        businessId,
        source: 'shopify',
        operation: 'payout_catchup_business',
        title: 'Shopify payout catch-up failed for organisation',
        error,
        context: { date_min: dateMin },
      });
      results.push({
        businessId,
        discovered: 0,
        processed: 0,
        failed: 1,
        error: error?.message ?? String(error),
      });
    }
  }

  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  return NextResponse.json({
    dateMin,
    businesses: businesses.length,
    discovered: results.reduce((sum, result) => sum + result.discovered, 0),
    processed: results.reduce((sum, result) => sum + result.processed, 0),
    failed,
    results,
  }, { status: failed > 0 ? 500 : 200 });
}