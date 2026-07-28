import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { syncCustomerServiceMailbox } from '@/lib/customer-service/syncMailbox';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(90, Number(body.days || 7)));
    const result = await syncCustomerServiceMailbox(user.businessId, { days });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}