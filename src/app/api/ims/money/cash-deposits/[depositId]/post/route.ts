import { NextResponse } from 'next/server';
import { executeCashDeposit } from '@/lib/ims/cashDepositExecutor';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function POST(_request: Request, { params }: { params: { depositId: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const depositId = Number(params.depositId);
  if (!Number.isInteger(depositId) || depositId <= 0) {
    return NextResponse.json({ error: 'Invalid deposit ID' }, { status: 400 });
  }
  try {
    const result = await executeCashDeposit(auth.user.businessId, depositId, { userId: auth.user.userId, name: auth.user.name });
    return NextResponse.json(result, { status: result.status === 'posted' ? 200 : 409 });
  } catch (error: any) {
    const message = error?.message ?? 'Cash deposit posting failed';
    const status = message === 'Cash deposit not found' ? 404 : message.includes('already being posted') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}