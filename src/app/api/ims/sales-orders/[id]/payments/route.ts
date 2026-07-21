import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { triggerSOPaymentXeroSync } from '@/lib/ims/xeroHooks';


export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const so = await ImsSORepo.get(Number(params.id), session.businessId);
    if (!so) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: so.payments ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const so = await ImsSORepo.get(Number(params.id), session.businessId);
    if (!so) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const body = await req.json();
    const { payment_date, amount, currency_code, exchange_rate, notes, payment_method_id } = body;
    if (!payment_date || !amount) {
      return NextResponse.json({ success: false, error: 'payment_date and amount are required' }, { status: 400 });
    }
    const parsedAmount = Number(amount);
    const parsedRate = Number(exchange_rate ?? 1);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ success: false, error: 'Amount must be a positive number' }, { status: 400 });
    }
    if (isNaN(parsedRate) || parsedRate <= 0) {
      return NextResponse.json({ success: false, error: 'Exchange rate must be a positive number' }, { status: 400 });
    }
    const payment = await ImsSORepo.addPayment(Number(params.id), {
      payment_date,
      amount: parsedAmount,
      currency_code: (currency_code ?? 'AUD').toUpperCase(),
      exchange_rate: parsedRate,
      amount_local: parsedAmount * parsedRate,
      notes: notes || undefined,
      payment_method_id: payment_method_id ? Number(payment_method_id) : undefined,
    }, session.businessId);

    // Fire-and-forget Xero payment sync (skipped silently if no payment method set)
    if (session?.businessId && payment?.id) {
      triggerSOPaymentXeroSync(session.businessId, Number(params.id), payment.id).catch(() => {});
    }

    return NextResponse.json({ success: true, data: payment });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
