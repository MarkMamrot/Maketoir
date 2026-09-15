import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  SalesChannelInstanceRepository,
  SalesChannelValidationError,
} from '@/lib/channels/channelInstanceRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

type Context = { params: { id: string } };

async function loadAmazonInstance(businessId: string, channelInstanceId: string) {
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  return instance?.provider === 'amazon' ? instance : null;
}

export async function GET(_request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  try {
    const instance = await loadAmazonInstance(businessId, channelInstanceId);
    if (!instance) return NextResponse.json({ error: 'Amazon channel not found.' }, { status: 404 });
    const locations = await imsQuery<{ id: number; name: string }>(
      `SELECT id, name FROM ims_locations
        WHERE business_id = ? AND is_active = 1
        ORDER BY name, id`,
      [businessId],
    );
    const configured = Number(instance.settings.orderLocationId ?? 0);
    return NextResponse.json({
      success: true,
      orderLocationId: locations.some(location => Number(location.id) === configured) ? configured : null,
      locations: locations.map(location => ({ id: Number(location.id), name: String(location.name) })),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'amazon.orders', operation: 'load_settings',
      title: 'Amazon order settings could not be loaded', error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    });
    return NextResponse.json({ error: 'Amazon order settings could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  try {
    const instance = await loadAmazonInstance(businessId, channelInstanceId);
    if (!instance) return NextResponse.json({ error: 'Amazon channel not found.' }, { status: 404 });
    const body = await request.json();
    const locationId = Math.floor(Number(body?.orderLocationId));
    if (!Number.isInteger(locationId) || locationId <= 0) {
      throw new SalesChannelValidationError('A valid Amazon dispatch location is required.');
    }
    const locations = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_locations
        WHERE business_id = ? AND id = ? AND is_active = 1
        LIMIT 1`,
      [businessId, locationId],
    );
    if (!locations[0]) throw new SalesChannelValidationError('The selected dispatch location is unavailable.');
    await SalesChannelInstanceRepository.setAmazonOrderLocationForBusiness({
      businessId, channelInstanceId, locationId,
    });
    return NextResponse.json({ success: true, orderLocationId: locationId });
  } catch (error) {
    if (error instanceof SalesChannelValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId, source: 'amazon.orders', operation: 'save_settings',
      title: 'Amazon order settings could not be saved', error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    });
    return NextResponse.json({ error: 'Amazon order settings could not be saved.' }, { status: 500 });
  }
}