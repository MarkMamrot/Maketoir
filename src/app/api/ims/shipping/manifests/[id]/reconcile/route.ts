import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reconcileShippingManifest } from '@/lib/ims/shipping/shippingManifests';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const manifestId = Number(params.id);
  if (!Number.isInteger(manifestId) || manifestId <= 0) return NextResponse.json({ error: 'A valid manifest ID is required.' }, { status: 400 });
  try {
    const body = await request.json();
    const providerOrderId = String(body?.providerOrderId ?? '').trim();
    if (!providerOrderId) return NextResponse.json({ error: 'Enter the carrier order ID.' }, { status: 400 });
    const data = await reconcileShippingManifest({ businessId: session.businessId, manifestId, providerOrderId });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reconcile the carrier manifest.';
    const validation = /not found|not ready|expected|required|credentials|does not contain/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_shipping', operation: 'reconcile_manifest',
        title: 'Carrier manifest reconciliation failed', error,
        context: { manifestId }, reference: { type: 'shipping_manifest', id: String(manifestId) },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 502 });
  }
}
