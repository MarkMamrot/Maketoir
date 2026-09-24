import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { setChannelProductOverrides } from '@/lib/channels/channelProductAssignmentRepository';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import type { ChannelProductOverrideMode } from '@/lib/channels/channelProductRules';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

const ACTION_TO_OVERRIDE = {
  include: 'include',
  exclude: 'exclude',
  allow_automation: 'automatic',
} as const satisfies Record<string, ChannelProductOverrideMode>;

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productIds = [...new Set(Array.isArray(body?.productIds)
    ? body.productIds.map(value => String(value).trim()).filter(Boolean)
    : [])];
  const channelInstanceIds = [...new Set(Array.isArray(body?.channelInstanceIds)
    ? body.channelInstanceIds.map(value => String(value).trim()).filter(Boolean)
    : [])];
  const action = String(body?.action ?? '') as keyof typeof ACTION_TO_OVERRIDE;
  if (productIds.length < 1 || productIds.length > 500 || channelInstanceIds.length < 1
    || channelInstanceIds.length > 50 || !ACTION_TO_OVERRIDE[action]) {
    return NextResponse.json({ error: 'Choose 1-500 products, 1-50 sales channels, and a valid action.' }, { status: 400 });
  }

  const businessId = String(session.businessId ?? '');
  const [instances, productRows] = await Promise.all([
    SalesChannelInstanceRepository.listForBusiness(businessId),
    imsQuery<{ product_id: string }>(
      `SELECT product_id FROM ims_products
        WHERE business_id = ? AND product_id IN (${productIds.map(() => '?').join(',')})`,
      [businessId, ...productIds],
    ),
  ]);
  const ownedChannels = new Set(instances.map(instance => instance.channelInstanceId));
  const ownedProducts = new Set(productRows.map(row => row.product_id));
  if (channelInstanceIds.some(id => !ownedChannels.has(id)) || productIds.some(id => !ownedProducts.has(id))) {
    return NextResponse.json({ error: 'One or more products or sales channels could not be found.' }, { status: 404 });
  }

  const overrideMode = ACTION_TO_OVERRIDE[action];
  const results = [] as Array<{ channelInstanceId: string; applied: number; success: boolean; error?: string }>;
  for (const channelInstanceId of channelInstanceIds) {
    try {
      const applied = await setChannelProductOverrides({ businessId, channelInstanceId, productIds, overrideMode });
      results.push({ channelInstanceId, applied, success: true });
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims.products',
        operation: 'bulk_channel_assignment',
        title: 'Products could not be assigned to a sales channel',
        error,
        context: { channelInstanceId, productCount: productIds.length, action },
        reference: { type: 'sales_channel_instance', id: channelInstanceId },
      }).catch(() => null);
      results.push({ channelInstanceId, applied: 0, success: false, error: 'Assignment could not be saved.' });
    }
  }
  return NextResponse.json({
    success: results.every(result => result.success),
    partial: results.some(result => result.success) && results.some(result => !result.success),
    results,
  });
}