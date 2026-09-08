import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { previewPersistedEarlyPaymentDiscountOrder } from '@/lib/ims/earlyPaymentDiscount';
import { ImsPORepo } from '@/lib/ims/ImsRepository';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    const po = await ImsPORepo.get(Number(params.id), session.businessId);
    if (!po) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const body = await req.json();
    const amount = Number(body.amount ?? 0);
    if (!body.payment_date || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ success: false, error: 'Enter a valid payment date and amount.' }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      data: previewPersistedEarlyPaymentDiscountOrder(po, { paymentDate: body.payment_date, amount }),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}