import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { shopifyReadinessFailureMessage, testShopifyReadiness } from '@/lib/channels/shopifyReadiness';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { getShopifyChannelAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { getAmazonMarketplaceParticipations, requireActiveAmazonAustraliaParticipation } from '@/lib/channels/amazonSpApi';

type Context = { params: { id: string } };

export async function POST(_: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }

  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  if (!channelInstanceId) return NextResponse.json({ success: false, error: 'Channel instance ID is required.' }, { status: 400 });

  try {
    const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
    if (!instance) return NextResponse.json({ success: false, error: 'Sales channel not found.' }, { status: 404 });
    if (instance.provider !== 'shopify' && instance.provider !== 'amazon') {
      return NextResponse.json({ success: false, error: 'Connection testing is not available for this provider yet.' }, { status: 400 });
    }

    try {
      if (instance.provider === 'shopify') {
        const disabled = await shopifyDisabledResponse(businessId);
        if (disabled) return disabled;
        const credentials = await getShopifyChannelAdminCredentials(businessId, channelInstanceId);
        if (!credentials) throw new Error('Shopify credentials are not configured.');
        await testShopifyReadiness(credentials);
      } else {
        const credentials = await getAmazonChannelAccess(businessId, channelInstanceId);
        if (!credentials) throw new Error('Amazon credentials are not configured.');
        requireActiveAmazonAustraliaParticipation(await getAmazonMarketplaceParticipations(credentials.accessToken));
      }
      const updated = await SalesChannelInstanceRepository.setReadinessForBusiness({
        businessId, channelInstanceId, ready: true,
      });
      return NextResponse.json({ success: true, instance: updated });
    } catch (error) {
      const safeError = instance.provider === 'shopify'
        ? shopifyReadinessFailureMessage(error)
        : (error instanceof Error && /does not have access|not participating|suspended/i.test(error.message)
          ? error.message
          : 'Amazon rejected the saved authorization.');
      await SalesChannelInstanceRepository.setReadinessForBusiness({
        businessId, channelInstanceId, ready: false, safeError,
      }).catch(() => null);
      await reportRuntimeIssue({
        businessId,
        source: 'ims.channels',
        operation: `test_${instance.provider}_connection`,
        title: `${instance.provider === 'shopify' ? 'Shopify' : 'Amazon'} channel connection test failed`,
        error,
        reference: { type: 'sales_channel_instance', id: channelInstanceId },
        context: { provider: instance.provider },
      }).catch(() => null);
      return NextResponse.json({ success: false, error: safeError }, { status: 502 });
    }
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims.channels',
      operation: 'prepare_connection_test',
      title: 'Sales channel connection test could not start',
      error,
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
      context: {},
    }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Connection test could not start.' }, { status: 500 });
  }
}
