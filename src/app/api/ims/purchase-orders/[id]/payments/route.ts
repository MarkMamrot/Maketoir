import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { triggerPOPaymentXeroSync } from '@/lib/ims/xeroHooks';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const po = await ImsPORepo.get(Number(params.id));
    if (!po) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: po.payments ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
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
    const payment = await ImsPORepo.addPayment(Number(params.id), {
      payment_date,
      amount: parsedAmount,
      currency_code: (currency_code ?? 'AUD').toUpperCase(),
      exchange_rate: parsedRate,
      amount_local: parsedAmount * parsedRate,
      notes: notes || undefined,
      payment_method_id: payment_method_id ? Number(payment_method_id) : undefined,
    });

    // Fire-and-forget Xero payment sync
    const session = getSession();
    if (session?.businessId && payment?.id) {
      triggerPOPaymentXeroSync(session.businessId, Number(params.id), payment.id).catch(() => {});
    }

    return NextResponse.json({ success: true, data: payment });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
