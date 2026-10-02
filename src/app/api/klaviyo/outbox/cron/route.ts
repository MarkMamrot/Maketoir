import { NextResponse } from 'next/server';

import { KlaviyoSettingsRepository } from '@/lib/klaviyo/settingsRepository';
import { processKlaviyoOutboxForBusiness, type KlaviyoWorkerResult } from '@/lib/klaviyo/worker';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface BusinessResult extends KlaviyoWorkerResult {
  businessId: string;
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body?.limit ?? 25)) || 25));
  let businessIds: string[];
  try {
    businessIds = await KlaviyoSettingsRepository.listEnabledBusinessIds();
  } catch (error) {
    await reportRuntimeIssue({
      source: 'klaviyo.outbox',
      operation: 'list_enabled_businesses',
      title: 'Klaviyo outbox scheduling failed',
      error,
    }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Unable to load enabled Klaviyo businesses.' }, { status: 500 });
  }

  const results: BusinessResult[] = [];
  let failedBusinesses = 0;
  for (const businessId of businessIds) {
    try {
      results.push({ businessId, ...await processKlaviyoOutboxForBusiness({ businessId, limit }) });
    } catch (error) {
      failedBusinesses += 1;
      await reportRuntimeIssue({
        businessId,
        source: 'klaviyo.outbox',
        operation: 'drain_business',
        title: 'Klaviyo outbox processing failed',
        error,
      }).catch(() => null);
    }
  }

  const totals = results.reduce((total, result) => ({
    processed: total.processed + result.processed,
    sent: total.sent + result.sent,
    skipped: total.skipped + result.skipped,
    failed: total.failed + result.failed,
    recovered: total.recovered + result.recovered,
  }), { processed: 0, sent: 0, skipped: 0, failed: 0, recovered: 0 });
  const status = failedBusinesses === 0 ? 200 : 207;
  return NextResponse.json({
    success: failedBusinesses === 0,
    businesses: businessIds.length,
    failedBusinesses,
    ...totals,
    results,
  }, { status });
}