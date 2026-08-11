import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { OrderAmendmentConflict } from '@/lib/ims/orderAmendmentPlan';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid sales order id.' }, { status: 400 });
  }
  try {
    const result = await ImsSORepo.createReplacement(soId, businessId);
    return NextResponse.json({ success: true, id: result.id, replayed: result.replayed });
  } catch (error: any) {
    if (error instanceof OrderAmendmentConflict) {
      return NextResponse.json({ success: false, error: error.message, code: 'replacement_not_allowed' }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_orders',
      operation: 'create_replacement',
      title: 'Sales order replacement creation failed',
      error,
      reference: { type: 'sales_order', id: soId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}