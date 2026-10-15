import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { DeliveryTrackingSettingsValidationError, validateDeliveryTrackingSettingsRequest } from '@/lib/ims/shipping/deliveryTrackingSettings';
import { getDeliveryTrackingChannels, saveDeliveryTrackingChannels } from '@/lib/ims/shipping/deliveryTrackingSettingsRepository';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers });
  try {
    const channels = await getDeliveryTrackingChannels(session.businessId);
    return NextResponse.json({ success: true, businessId: session.businessId, channels, readOnly: session.tier === 'Advisor' }, { headers });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_shipping', operation: 'load_delivery_tracking_settings',
      title: 'Delivery tracking settings could not be loaded', error,
      context: { settingsArea: 'delivery_tracking' }, reference: { type: 'business', id: session.businessId },
    });
    return NextResponse.json({ success: false, error: 'Delivery tracking settings could not be loaded. Check Runtime Issues.' }, { status: 500, headers });
  }
}

export async function PUT(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403, headers });
  try {
    let body: unknown;
    try { body = await request.json(); } catch (error) {
      if (error instanceof SyntaxError) return NextResponse.json({ error: 'Submit valid JSON settings.' }, { status: 400, headers });
      throw error;
    }
    const input = validateDeliveryTrackingSettingsRequest(body);
    if (input.expectedBusinessId !== session.businessId) {
      return NextResponse.json({ error: 'The active business changed. Reload delivery tracking settings before saving.' }, { status: 409, headers });
    }
    await saveDeliveryTrackingChannels(session.businessId, input.channels);
    return NextResponse.json({ success: true, businessId: session.businessId, channels: input.channels, readOnly: false }, { headers });
  } catch (error) {
    if (error instanceof DeliveryTrackingSettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    }
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_shipping', operation: 'save_delivery_tracking_settings',
      title: 'Delivery tracking settings could not be saved', error,
      context: { settingsArea: 'delivery_tracking' }, reference: { type: 'business', id: session.businessId },
    });
    return NextResponse.json({ success: false, error: 'Delivery tracking settings could not be saved. Reload saved settings and check Runtime Issues.' }, { status: 500, headers });
  }
}
