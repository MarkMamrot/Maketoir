import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsContactsRepo } from '@/lib/ims/ImsRepository';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') {
    return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });
  }

  const contactId = Number(params.id);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid contact id' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount);
  const reason = String(body?.reason ?? '').trim();
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ success: false, error: 'Adjustment amount must be a non-zero number' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ success: false, error: 'A reason is required' }, { status: 400 });
  }

  try {
    const result = await ImsContactsRepo.adjustStoreCredit(
      contactId,
      String(session.businessId),
      amount,
      reason,
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const message = error?.message ?? 'Unable to adjust store credit';
    const status = message === 'Active customer contact not found' ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}