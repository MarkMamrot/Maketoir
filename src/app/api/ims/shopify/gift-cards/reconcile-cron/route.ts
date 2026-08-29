import { NextResponse } from 'next/server';

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { decrypt } from '@/lib/encryption';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';
import { syncShopifyGiftCardSnapshots } from '@/lib/ims/shopifyGiftCardSync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export const runtime = 'nodejs';
export const maxDuration = 1800;

interface BusinessRow {
  business_id: string;
}

interface CronResult {
  businessId: string;
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
      await runImsForBusiness(businessId, async () => {
        const settingRows = await imsQuery<{ value: string }>(
          "SELECT value FROM ims_settings WHERE `key` = 'shopify_gc_mode' LIMIT 1",
        );
        if (settingRows[0]?.value !== 'combined') {
          results.push({ businessId, status: 'skipped', reason: 'gift_card_sync_disabled' });
          return;
        }

        const { getShopifyAdminCredentials } = await import('@/lib/shopifyCredentials');
        const credentials = await getShopifyAdminCredentials(businessId);
        if (!credentials) {
          results.push({ businessId, status: 'skipped', reason: 'shopify_not_connected' });
          return;
        }
        const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
        const result = await syncShopifyGiftCardSnapshots(businessId, shopify);
        results.push({
          businessId,
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