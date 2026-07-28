import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { updateCustomerServiceMailboxState } from '@/lib/customer-service/mailboxActions';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const body = await req.json();
    if (!['read', 'unread', 'archive'].includes(body.action)) {
      return NextResponse.json({ error: 'Invalid mailbox action' }, { status: 400 });
    }
    await updateCustomerServiceMailboxState({ businessId: user.businessId, threadId: Number(params.id), action: body.action });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}