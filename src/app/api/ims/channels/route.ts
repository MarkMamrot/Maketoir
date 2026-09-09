import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { createDefaultSalesChannelRegistry } from '@/lib/channels/defaultRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId ?? '');
  try {
    const registry = createDefaultSalesChannelRegistry();
    const instances = await SalesChannelInstanceRepository.listForBusiness(businessId);
    return NextResponse.json({
      success: true,
      instances: instances.map(instance => ({
        ...instance,
        providerDisplayName: registry.get(instance.provider).displayName,
        capabilities: registry.get(instance.provider).capabilities,
      })),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims.channels',
      operation: 'list',
      title: 'Sales channels could not be loaded',
      error,
      context: {},
    });
    return NextResponse.json({ success: false, error: 'Sales channels could not be loaded.' }, { status: 500 });
  }
}
