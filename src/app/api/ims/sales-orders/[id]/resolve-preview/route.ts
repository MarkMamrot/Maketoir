import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { previewCustomerResolution } from '@/lib/ims/orderResolution/customerResolution';
import type { OrderResolutionOutcome } from '@/lib/ims/orderResolution/domain';

const OUTCOMES = new Set<OrderResolutionOutcome>(['leave_partial', 'cancel_remainder', 'create_backorder']);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json();
    const outcome = String(body.outcome ?? '') as OrderResolutionOutcome;
    if (!OUTCOMES.has(outcome)) return NextResponse.json({ error: 'Choose a valid outstanding-quantity outcome.' }, { status: 400 });
    return NextResponse.json({ success: true, data: await previewCustomerResolution(session.businessId as string, soId, outcome) });
  } catch (error: any) {
    const message = String(error?.message ?? 'Unable to preview outstanding quantity.');
    const status = message.includes('not found') ? 404 : message.includes('Only ') || message.includes('no outstanding') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
