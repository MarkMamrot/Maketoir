import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { createShippingDrafts } from '@/lib/ims/shipping/shippingDrafts';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  try {
    const body = await request.json();
    const data = await createShippingDrafts({
      businessId: session.businessId,
      operationKey: String(body?.operationKey ?? ''),
      carrierAccountId: Number(body?.carrierAccountId),
      shipments: Array.isArray(body?.shipments) ? body.shipments : [],
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to prepare shipments.';
    const validation = /required|choose|not found|incomplete|cannot|exceeds|remaining|already used/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_shipping', operation: 'create_drafts',
        title: 'Shipping drafts could not be created', error,
        context: { shipmentCount: undefined },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 500 });
  }
}