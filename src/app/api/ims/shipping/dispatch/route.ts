import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { dispatchShippingShipment } from '@/lib/ims/shipping/shippingDispatch';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  let shipmentIds: number[] = [];
  try {
    const body = await request.json();
    shipmentIds = [...new Set((Array.isArray(body?.shipmentIds) ? body.shipmentIds : []).map(Number))];
    if (!shipmentIds.length || shipmentIds.some(id => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: 'Choose at least one labelled shipment.' }, { status: 400 });
    }
    const data = [];
    for (const shipmentId of shipmentIds) data.push(await dispatchShippingShipment({ businessId: session.businessId, shipmentId }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to mark shipments dispatched.';
    if (error instanceof FifoCostingConflict) {
      return NextResponse.json({ success: false, error: message, code: error.code }, { status: error.status });
    }
    const validation = /not found|only after|at least one|required|already|mapped|quantity|Insufficient/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_shipping', operation: 'dispatch_shipments',
        title: 'Shipping dispatch could not update Sales Orders', error, context: { shipmentIds },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 500 });
  }
}