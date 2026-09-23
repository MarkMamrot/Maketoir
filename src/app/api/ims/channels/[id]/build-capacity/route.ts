import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { resolveChannelBuildCapacityPolicy } from '@/lib/channels/buildCapacityPolicy';
import {
  SalesChannelInstanceRepository,
  SalesChannelValidationError,
} from '@/lib/channels/channelInstanceRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

type Context = { params: { id: string } };

async function authorize(context: Context) {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) } as const;
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) } as const;
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(context.params.id ?? '').trim();
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  if (!instance) return { response: NextResponse.json({ error: 'Sales channel not found.' }, { status: 404 }) } as const;
  return { businessId, channelInstanceId, instance } as const;
}

async function loadLocations(businessId: string) {
  const locations = await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_locations
      WHERE business_id = ? AND is_active = 1
      ORDER BY name, id`,
    [businessId],
  );
  return locations.map(location => ({ id: Number(location.id), name: String(location.name) }));
}

export async function GET(_: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    const locations = await loadLocations(auth.businessId);
    const policy = resolveChannelBuildCapacityPolicy(auth.instance.settings);
    return NextResponse.json({ success: true, ...policy, locations });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.businessId,
      source: 'ims.channels',
      operation: 'load_build_capacity_settings',
      title: 'Channel Build Capacity settings could not be loaded',
      error,
      context: { channelInstanceId: auth.channelInstanceId },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Channel Build Capacity settings could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json() as { enabled?: unknown; inventoryLocationIds?: unknown };
    if (typeof body.enabled !== 'boolean' || !Array.isArray(body.inventoryLocationIds)) {
      throw new SalesChannelValidationError('Enabled and inventory locations are required.');
    }
    const requestedLocationIds = [...new Set(body.inventoryLocationIds.map(value => Math.floor(Number(value))))];
    if (requestedLocationIds.some(locationId => !Number.isInteger(locationId) || locationId <= 0)) {
      throw new SalesChannelValidationError('Channel inventory locations must contain valid location IDs.');
    }
    const locations = await loadLocations(auth.businessId);
    const activeLocationIds = new Set(locations.map(location => location.id));
    if (requestedLocationIds.some(locationId => !activeLocationIds.has(locationId))) {
      throw new SalesChannelValidationError('A selected inventory location is unavailable.');
    }
    const instance = await SalesChannelInstanceRepository.setBuildCapacityPolicyForBusiness({
      businessId: auth.businessId,
      channelInstanceId: auth.channelInstanceId,
      enabled: body.enabled,
      inventoryLocationIds: requestedLocationIds,
    });
    return NextResponse.json({
      success: true,
      ...resolveChannelBuildCapacityPolicy(instance?.settings ?? {}),
      locations,
    });
  } catch (error) {
    if (error instanceof SalesChannelValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId: auth.businessId,
      source: 'ims.channels',
      operation: 'save_build_capacity_settings',
      title: 'Channel Build Capacity settings could not be saved',
      error,
      context: { channelInstanceId: auth.channelInstanceId },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Channel Build Capacity settings could not be saved.' }, { status: 500 });
  }
}