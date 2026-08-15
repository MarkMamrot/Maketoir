import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { triggerPOPaymentXeroSync } from '@/lib/ims/xeroHooks';


export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const po = await ImsPORepo.get(Number(params.id), session.businessId);
    if (!po) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: po.payments ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const po = await ImsPORepo.get(Number(params.id), session.businessId);
    if (!po) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (po.status === 'backordered') {
      return NextResponse.json({
        success: false,
        error: 'Release this supplier backorder before recording a payment.',
      }, { status: 409 });
    }
    const body = await req.json();
    const { payment_date, amount, currency_code, exchange_rate, notes, payment_method_id } = body;
    const xeroPostIntent = body.xero_post_intent ?? 'solvantis_only';
    if (!['solvantis_only', 'post_to_xero'].includes(xeroPostIntent)) {
      return NextResponse.json({ success: false, error: 'Choose Record in Solvantis only or Post to Xero.' }, { status: 400 });
    }
    if (xeroPostIntent === 'post_to_xero' && !payment_method_id) {
      return NextResponse.json({ success: false, error: 'Choose a payment method before posting to Xero.' }, { status: 400 });
    }
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
      xero_post_intent: xeroPostIntent,
    }, session.businessId);

    const xeroResult = xeroPostIntent === 'post_to_xero' && session?.businessId && payment?.id
      ? await triggerPOPaymentXeroSync(session.businessId, Number(params.id), payment.id)
      : null;

    return NextResponse.json({
      success: true,
      data: xeroResult ? { ...payment, xero_post_status: xeroResult.status, xero_payment_id: xeroResult.xeroPaymentId, xero_post_error: xeroResult.warning } : payment,
      ...(xeroResult?.warning ? { xeroWarning: xeroResult.warning } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
