import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { submitShippingDraftsAndCreateLabels } from '@/lib/ims/shipping/shippingSubmission';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  let shipmentIds: number[] = [];
  try {
    const body = await request.json();
    shipmentIds = Array.isArray(body?.shipmentIds) ? body.shipmentIds.map(Number) : [];
    const data = await submitShippingDraftsAndCreateLabels({ businessId: session.businessId, shipmentIds });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit shipments to Australia Post.';
    const validation = /choose|not found|no parcels|not supported|already|requires review|before submission|no more than|price changed|no longer available/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'ims_shipping',
        operation: 'submit_and_create_labels',
        title: 'Australia Post shipment or label creation failed',
        error,
        context: { shipmentIds },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 502 });
  }
}