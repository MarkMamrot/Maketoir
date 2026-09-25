import { NextResponse } from 'next/server';

import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';
import { syncShopifyGiftCardSnapshots } from '@/lib/ims/shopifyGiftCardSync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export const runtime = 'nodejs';
export const maxDuration = 1800;

interface BusinessRow {
  business_id: string;
}

interface CronResult {
  businessId: string;
  channelInstanceId?: string;
  status: 'synced' | 'skipped' | 'failed';
  reason?: string;
  synced?: number;
  inserted?: number;
  updated?: number;
  reviewRequired?: number;
  transactionHistoryAvailable?: boolean;
  errors?: number;
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let businesses: BusinessRow[];
  try {
    businesses = await query<BusinessRow>(
      `SELECT business_id
         FROM businesses
        WHERE deleted_at IS NULL
          AND COALESCE(automation_paused, 0) = 0`,
      [],
    );
  } catch (error) {
    await reportRuntimeIssue({
      source: 'cron',
      operation: 'shopify_gift_card_load_businesses',
      severity: 'critical',
      title: 'Daily Shopify gift card reconciliation could not load organisations',
      error,
    });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: CronResult[] = [];
  for (const { business_id: businessId } of businesses) {
    try {
      const capabilities = await getOnlineChannelCapabilities(businessId);
      if (!capabilities.shopifyEnabled) {
        results.push({ businessId, status: 'skipped', reason: 'shopify_disabled' });
        continue;
      }
      const instances = (await SalesChannelInstanceRepository.listForBusiness(businessId))
        .filter(instance => instance.provider === 'shopify'
          && instance.enabled
          && instance.runtimeStatus === 'active'
          && instance.readinessStatus === 'ready'
          && shopifyInstanceSettings(instance.settings).giftCards.mode === 'combined');
      if (!instances.length) {
        results.push({ businessId, status: 'skipped', reason: 'gift_card_sync_disabled' });
        continue;
      }
      for (const instance of instances) {
        const channelInstanceId = instance.channelInstanceId;
        try {
          await runImsForBusiness(businessId, async () => {
            const context = await getShopifyOperationContext({ businessId, channelInstanceId });
            const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
            const result = await syncShopifyGiftCardSnapshots(businessId, channelInstanceId, shopify);
            results.push({
              businessId,
              channelInstanceId,
              status: result.errors ? 'failed' : 'synced',
              synced: result.synced,
              inserted: result.inserted,
              updated: result.updated,
              reviewRequired: result.reviewRequired,
              transactionHistoryAvailable: result.transactionHistoryAvailable,
              errors: result.errors,
            });
          });
        } catch (error) {
          await reportRuntimeIssue({
            businessId,
            source: 'cron',
            operation: 'shopify_gift_card_reconciliation',
            title: 'Daily Shopify gift card reconciliation failed for store',
            error,
            context: { channelInstanceId },
          });
          results.push({ businessId, channelInstanceId, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'cron',
        operation: 'shopify_gift_card_reconciliation',
        title: 'Daily Shopify gift card reconciliation failed for organisation',
        error,
      });
      results.push({ businessId, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const failed = results.filter(result => result.status === 'failed').length;
  return NextResponse.json({
    ok: failed === 0,
    businesses: businesses.length,
    synced: results.filter(result => result.status === 'synced').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    failed,
    results,
  }, { status: failed ? 207 : 200 });
}