import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reconcileShopifyFulfilmentsForChannel } from '@/lib/channels/shopifyFulfilmentReconciliation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

const DEFAULT_WINDOW_HOURS = 36;
const MAX_WINDOW_HOURS = 168;

export async function POST(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedHours = body && typeof body === 'object' && 'hours' in body ? body.hours : DEFAULT_WINDOW_HOURS;
  if (typeof requestedHours !== 'number' || !Number.isInteger(requestedHours) || requestedHours < 1 || requestedHours > MAX_WINDOW_HOURS) {
    return NextResponse.json({ error: `Hours must be a whole number from 1 to ${MAX_WINDOW_HOURS}.` }, { status: 400 });
  }

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - (requestedHours * 60 * 60 * 1000));
  const channelInstanceId = String(params.id ?? '').trim();
  try {
    const result = await reconcileShopifyFulfilmentsForChannel({
      businessId: session.businessId,
      channelInstanceId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
    if (result.repaired.length > 0) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'shopify.orders',
        operation: 'fulfilment_reconciliation_backfill',
        severity: 'warning',
        title: 'Shopify fulfilments were repaired by manual reconciliation',
        error: 'The usual Shopify webhook pathway did not bring these Sales Orders up to date.',
        context: {
          channelInstanceId,
          trigger: 'manual',
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
          repairedCount: result.repaired.length,
          salesOrderIds: result.repaired.map(item => item.salesOrderId),
          shopifyOrderIds: result.repaired.map(item => item.shopifyOrderId),
        },
        reference: { type: 'sales_channel_instance', id: channelInstanceId },
      });
    }
    const unresolvedCount = result.failures.length + result.reviewRequired.length;
    if (unresolvedCount > 0) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'shopify.orders',
        operation: 'fulfilment_reconciliation_failed',
        title: 'Shopify fulfilments require reconciliation review',
        error: 'Some fully fulfilled Shopify orders could not be reconciled automatically.',
        context: {
          channelInstanceId,
          trigger: 'manual',
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
          failures: result.failures,
          reviewRequired: result.reviewRequired,
        },
        reference: { type: 'sales_channel_instance', id: channelInstanceId },
      });
    }
    return NextResponse.json({
      success: unresolvedCount === 0,
      ...result,
    }, { status: unresolvedCount === 0 ? 200 : 207 });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify.orders',
      operation: 'manual_fulfilment_reconciliation',
      title: 'Manual Shopify fulfilment reconciliation failed',
      error,
      context: { channelInstanceId, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() },
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Shopify fulfilment reconciliation failed.' }, { status: 500 });
  }
}