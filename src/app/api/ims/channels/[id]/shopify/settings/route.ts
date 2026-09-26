import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import {
  mergeShopifyInstanceSettings,
  ShopifyInstanceSettingsValidationError,
  shopifyInstanceSettings,
  type ShopifyInstanceSettingsPatch,
} from '@/lib/channels/shopifyInstanceSettings';
import { assertShopifyEnabled, isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

async function ownedShopifyInstance(businessId: string, channelInstanceId: string) {
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  return instance?.provider === 'shopify' ? instance : null;
}

export async function GET(_: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  try {
    await assertShopifyEnabled(session.businessId);
    const instance = await ownedShopifyInstance(session.businessId, params.id);
    if (!instance) return NextResponse.json({ error: 'Shopify storefront not found.' }, { status: 404 });
    return NextResponse.json({ success: true, channelInstanceId: params.id, settings: shopifyInstanceSettings(instance.settings) });
  } catch (error) {
    if (isOnlineChannelDisabledError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify_settings',
      operation: 'load_exact_instance',
      title: 'Shopify storefront settings could not be loaded',
      error,
      context: { channelInstanceId: params.id },
      reference: { type: 'sales_channel_instance', id: params.id },
    }).catch(() => undefined);
    return NextResponse.json({ error: 'Shopify storefront settings could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  try {
    await assertShopifyEnabled(session.businessId);
    const instance = await ownedShopifyInstance(session.businessId, params.id);
    if (!instance) return NextResponse.json({ error: 'Shopify storefront not found.' }, { status: 404 });
    const body = await request.json();
    const patch = body?.settings as ShopifyInstanceSettingsPatch;
    const settings = mergeShopifyInstanceSettings(instance.settings, patch);
    const updated = await SalesChannelInstanceRepository.setShopifySettingsForBusiness({
      businessId: session.businessId,
      channelInstanceId: params.id,
      settings,
    });
    if (!updated) return NextResponse.json({ error: 'Shopify storefront not found.' }, { status: 404 });
    return NextResponse.json({ success: true, channelInstanceId: params.id, settings });
  } catch (error) {
    if (error instanceof ShopifyInstanceSettingsValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status: 400 });
    }
    if (isOnlineChannelDisabledError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify_settings',
      operation: 'save_exact_instance',
      title: 'Shopify storefront settings could not be saved',
      error,
      context: { channelInstanceId: params.id },
      reference: { type: 'sales_channel_instance', id: params.id },
    }).catch(() => undefined);
    return NextResponse.json({ error: 'Shopify storefront settings could not be saved.' }, { status: 500 });
  }
}