import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function channelInstanceId(request: Request): string {
  return new URL(request.url).searchParams.get('channelInstanceId')?.trim() ?? '';
}

async function loadOwnedInstance(businessId: string, id: string) {
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, id);
  return instance?.provider === 'shopify' ? instance : null;
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = channelInstanceId(request);
  if (!id) return NextResponse.json({ error: 'Select a Shopify storefront.' }, { status: 400 });
  const instance = await loadOwnedInstance(session.businessId, id);
  if (!instance) return NextResponse.json({ error: 'Shopify storefront not found.' }, { status: 404 });
  return NextResponse.json({ success: true, channelInstanceId: id, settings: shopifyInstanceSettings(instance.settings) });
}

export async function PUT(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const id = channelInstanceId(request);
  if (!id) return NextResponse.json({ error: 'Select a Shopify storefront.' }, { status: 400 });
  try {
    const instance = await loadOwnedInstance(session.businessId, id);
    if (!instance) return NextResponse.json({ error: 'Shopify storefront not found.' }, { status: 404 });
    const current = shopifyInstanceSettings(instance.settings);
    const body = await request.json();
    const orders = body?.orders ?? {};
    const xero = body?.xero ?? {};
    const syncFrom = String(orders.syncFrom ?? '').trim();
    const locationId = Number(orders.locationId ?? 0);
    if (orders.enabled === true && (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom) || !Number.isInteger(locationId) || locationId <= 0)) {
      return NextResponse.json({ error: 'Enabled order sync requires a start date and online orders location.' }, { status: 400 });
    }
    const settings = {
      ...current,
      orders: {
        ...current.orders,
        enabled: orders.enabled === true,
        syncFrom: syncFrom || null,
        locationId: Number.isInteger(locationId) && locationId > 0 ? locationId : null,
      },
      xero: {
        ...current.xero,
        dailyAutoSyncEnabled: xero.dailyAutoSyncEnabled === true,
      },
    };
    await SalesChannelInstanceRepository.setShopifySettingsForBusiness({
      businessId: session.businessId,
      channelInstanceId: id,
      settings,
    });
    return NextResponse.json({ success: true, channelInstanceId: id, settings });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify_settings',
      operation: 'save_exact_instance',
      title: 'Shopify storefront settings could not be saved',
      error,
      context: { channelInstanceId: id },
      reference: { type: 'sales_channel_instance', id },
    });
    return NextResponse.json({ error: 'Shopify storefront settings could not be saved.' }, { status: 500 });
  }
}