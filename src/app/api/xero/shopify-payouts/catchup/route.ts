import { NextRequest, NextResponse } from 'next/server';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import {
  fetchPaidShopifyPayouts,
  getShopifyApiCreds,
  ingestShopifyPayout,
} from '@/lib/ims/shopifyPayoutIngestion';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';

export const runtime = 'nodejs';
export const maxDuration = 300;

function dateMinForDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => ({}));
  const businessId = String(body.databaseId ?? auth.user!.businessId);
  const denied = assertBusinessAccess(auth.user!, businessId);
  if (denied) return denied;

  const days = Number(body.days ?? 14);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return NextResponse.json({ error: 'days must be a whole number from 1 to 90' }, { status: 400 });
  }

  try {
    const result = await runImsForBusiness(businessId, async () => {
      const creds = await getShopifyApiCreds(businessId);
      if (!creds) throw new Error('Shopify credentials are unavailable');
      const dateMin = dateMinForDays(days);
      const payouts = await fetchPaidShopifyPayouts(creds, dateMin);
      const results: Array<{ payoutId: string; status: string; error?: string }> = [];
      for (const payout of payouts) {
        const payoutId = String(payout?.id ?? 'unknown');
        try {
          const ingested = await ingestShopifyPayout(businessId, payout, creds);
          results.push({ payoutId, status: ingested.status });
        } catch (error: any) {
          results.push({ payoutId, status: 'failed', error: error?.message ?? String(error) });
        }
      }
      const failed = results.filter(item => item.status === 'failed').length;
      return {
        dateMin,
        days,
        discovered: payouts.length,
        processed: payouts.length - failed,
        failed,
        results,
      };
    });
    return NextResponse.json(result, { status: result.failed > 0 ? 207 : 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}