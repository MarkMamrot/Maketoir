import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { sendCustomerServiceReply } from '@/lib/customer-service/replyActions';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const result = await sendCustomerServiceReply(user.businessId, Number(params.id), user.userId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  }
}