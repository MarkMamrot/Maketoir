import { NextResponse } from 'next/server';
import { checkCronJobEnabled } from '@/lib/cron/settings';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { pollAmazonDeliveryEvidence } from '@/lib/securityCompliance/amazonDeliveryPolling';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const paused = await checkCronJobEnabled('amazon-delivery-tracking');
  if (paused) return paused;
  const totals = { businesses: 0, failedBusinesses: 0, deferredBusinesses: 0, attempted: 0, delivered: 0, pending: 0, failed: 0, deferred: 0 };
  const requestTimes = new Map<string, number>();
  const deadline = Date.now() + 240_000;
  try {
    const businesses = await query<{ business_id: string }>(
      `SELECT b.business_id FROM businesses b WHERE b.deleted_at IS NULL AND COALESCE(b.automation_paused, 0) = 0
        AND EXISTS (SELECT 1 FROM sales_channel_instances instance
          WHERE BINARY instance.business_id = BINARY b.business_id AND instance.provider = 'amazon')
        ORDER BY b.business_id`);
    totals.businesses = businesses.length;
    for (const business of businesses) {
      if (Date.now() >= deadline) { totals.deferredBusinesses++; continue; }
      try {
        const result = await pollAmazonDeliveryEvidence(business.business_id, requestTimes, deadline);
        for (const key of ['attempted', 'delivered', 'pending', 'failed', 'deferred'] as const) totals[key] += result[key];
      } catch (error) {
        totals.failedBusinesses++;
        await reportRuntimeIssue({
          businessId: business.business_id, source: 'amazon.delivery-tracking', operation: 'poll_business',
          title: 'Amazon delivery tracking could not scan a business', error,
        });
      }
    }
    const success = totals.failed === 0 && totals.failedBusinesses === 0;
    return NextResponse.json({ success, ...totals }, { status: success ? 200 : 207, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await reportRuntimeIssue({ source: 'amazon.delivery-tracking', operation: 'scheduled_poll', title: 'Amazon delivery tracking run failed', error });
    return NextResponse.json({ success: false, error: 'Delivery tracking failed. Check Runtime Issues.', ...totals }, { status: 503 });
  }
}
