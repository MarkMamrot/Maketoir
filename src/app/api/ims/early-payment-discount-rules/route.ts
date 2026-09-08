import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { EarlyPaymentDiscountRulesRepository } from '@/lib/ims/earlyPaymentDiscountRules';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await EarlyPaymentDiscountRulesRepository.list(session.businessId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'early_payment_discounts', operation: 'list_rules', title: 'Early-payment discount rules could not be loaded', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Early-payment discount rules could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  try {
    const body = await request.json();
    const id = await EarlyPaymentDiscountRulesRepository.create(body, session.businessId, session.userId);
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error: any) {
    const validation = error instanceof Error && /must be|percentage|days/i.test(error.message);
    if (!validation) await reportRuntimeIssue({ businessId: session.businessId, source: 'early_payment_discounts', operation: 'create_rule', title: 'Early-payment discount rule could not be created', error }).catch(() => {});
    return NextResponse.json({ success: false, error: validation ? error.message : 'Early-payment discount rule could not be created.' }, { status: validation ? 400 : 500 });
  }
}