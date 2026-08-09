import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reconcileOrderResolution, type ResolutionSide } from '@/lib/ims/orderResolution/xeroReconciliation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(
  request: Request,
  { params }: { params: { type: string; id: string } },
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') {
    return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  }

  const side = params.type as ResolutionSide;
  const resolutionId = Number(params.id);
  if (!['customer', 'supplier'].includes(side) || !Number.isInteger(resolutionId) || resolutionId <= 0) {
    return NextResponse.json({ error: 'Invalid order resolution.' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const data = await reconcileOrderResolution({
      businessId: session.businessId as string,
      side,
      resolutionId,
      authoriseDraft: body.authoriseDraft === true,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Xero reconciliation failed.';
    const conflict = message.includes('already being processed') || message.includes('unknown Xero result');
    const notFound = message.includes('not found');
    if (!conflict && !notFound) {
      await reportRuntimeIssue({
        businessId: session.businessId as string,
        source: 'ims_order_resolutions',
        operation: 'retry_xero_reconciliation',
        title: 'Order resolution Xero retry failed',
        error,
        reference: { type: `${side}_resolution`, id: String(resolutionId) },
      });
    }
    return NextResponse.json({ error: message }, { status: conflict ? 409 : notFound ? 404 : 500 });
  }
}
