import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { quoteShippingRequest } from '@/lib/ims/shipping/shippingQuotes';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let carrierAccountId: number | null = null;
  try {
    const body = await request.json();
    carrierAccountId = Number(body?.carrierAccountId);
    const data = await quoteShippingRequest({
      businessId: session.businessId,
      carrierAccountId,
      shipments: Array.isArray(body?.shipments) ? body.shipments : [],
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to quote shipments.';
    const validation = /required|choose|not found|incomplete|cannot|exceeds|remaining|already used|not supported|not enabled|valid|country|HS code|dangerous|restricted|confirm|declared value/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'ims_shipping',
        operation: 'quote_shipments',
        title: 'Shipping prices could not be retrieved',
        error,
        context: { carrierAccountId: Number.isFinite(carrierAccountId) ? carrierAccountId : null },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 502 });
  }
}