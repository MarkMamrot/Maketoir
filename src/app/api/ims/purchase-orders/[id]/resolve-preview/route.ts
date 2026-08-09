import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { previewSupplierResolution } from '@/lib/ims/orderResolution/supplierResolution';
import type { OrderResolutionOutcome } from '@/lib/ims/orderResolution/domain';

const OUTCOMES = new Set<OrderResolutionOutcome>(['leave_partial', 'cancel_remainder', 'create_backorder']);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const poId = Number(params.id);
  if (!Number.isInteger(poId) || poId <= 0) {
    return NextResponse.json({ error: 'Invalid purchase order ID.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const outcome = String(body.outcome ?? '') as OrderResolutionOutcome;
    if (!OUTCOMES.has(outcome)) {
      return NextResponse.json({ error: 'Choose a valid outstanding-quantity outcome.' }, { status: 400 });
    }
    const data = await previewSupplierResolution(session.businessId as string, poId, outcome);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    const message = String(error?.message ?? 'Unable to preview outstanding quantity.');
    const status = message.includes('not found')
      ? 404
      : message.includes('Only ') || message.includes('no outstanding')
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
