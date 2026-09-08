import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { EarlyPaymentDiscountRulesRepository } from '@/lib/ims/earlyPaymentDiscountRules';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export async function PUT(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid rule id.' }, { status: 400 });
  try {
    const updated = await EarlyPaymentDiscountRulesRepository.update(id, await request.json(), session.businessId);
    if (!updated) return NextResponse.json({ success: false, error: 'Rule not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const validation = error instanceof Error && /must be|percentage|days/i.test(error.message);
    if (!validation) await reportRuntimeIssue({ businessId: session.businessId, source: 'early_payment_discounts', operation: 'update_rule', title: 'Early-payment discount rule could not be updated', error, reference: { type: 'early_payment_discount_rule', id } }).catch(() => {});
    return NextResponse.json({ success: false, error: validation ? error.message : 'Early-payment discount rule could not be updated.' }, { status: validation ? 400 : 500 });
  }
}

export async function DELETE(_: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid rule id.' }, { status: 400 });
  try {
    const updated = await EarlyPaymentDiscountRulesRepository.deactivate(id, session.businessId);
    if (!updated) return NextResponse.json({ success: false, error: 'Rule not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'early_payment_discounts', operation: 'deactivate_rule', title: 'Early-payment discount rule could not be deactivated', error, reference: { type: 'early_payment_discount_rule', id } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Early-payment discount rule could not be deactivated.' }, { status: 500 });
  }
}