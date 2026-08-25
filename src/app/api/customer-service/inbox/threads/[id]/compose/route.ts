import { NextResponse } from 'next/server';
import { createCustomerServiceManualDraft } from '@/lib/customer-service/repository';
import { sendCustomerServiceReply } from '@/lib/customer-service/replyActions';
import { requireAdminSession } from '@/lib/sessionUtils';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const threadId = Number(params.id);
    const input = await req.json();
    const targetMessageId = Number(input.targetMessageId);
    const composeType = input.composeType === 'forward' ? 'forward' : 'manual_reply';
    if (!Number.isInteger(threadId) || !Number.isInteger(targetMessageId)) {
      return NextResponse.json({ success: false, error: 'Invalid conversation or email' }, { status: 400 });
    }
    const { draftId } = await createCustomerServiceManualDraft({
      businessId: user.businessId,
      threadId,
      targetMessageId,
      composeType,
      recipientEmail: String(input.recipientEmail || ''),
      subject: String(input.subject || ''),
      body: String(input.body || ''),
      operationKey: String(input.operationKey || ''),
      userId: user.userId,
    });
    const result = await sendCustomerServiceReply(user.businessId, draftId, user.userId);
    return NextResponse.json({ success: true, draftId, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: String(error?.message || 'Message could not be sent') }, { status: 409 });
  }
}