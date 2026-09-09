import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { createShippingManifest, listShippingManifestWorkspace } from '@/lib/ims/shipping/shippingManifests';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await listShippingManifestWorkspace(session.businessId) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_shipping', operation: 'list_manifests',
      title: 'Shipping manifests could not be loaded', error,
    });
    return NextResponse.json({ success: false, error: 'Unable to load shipping manifests.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  try {
    const body = await request.json();
    const data = await createShippingManifest({
      businessId: session.businessId,
      operationKey: String(body?.operationKey ?? ''),
      shipmentIds: Array.isArray(body?.shipmentIds) ? body.shipmentIds : [],
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create the carrier manifest.';
    const validation = /choose|must|required|not found|already|different|cannot|unknown|expected|support|credentials|changed/i.test(message);
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 502 });
  }
}
