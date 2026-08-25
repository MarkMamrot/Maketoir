import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { createCustomerServiceNewMessageDraft } from '@/lib/customer-service/repository';
import { sendCustomerServiceReply } from '@/lib/customer-service/replyActions';
import { requireAdminSession } from '@/lib/sessionUtils';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  await getImsSession();

  try {
    const input = await req.json();
    const { draftId, threadId } = await createCustomerServiceNewMessageDraft({
      businessId: user.businessId,
      contactId: Number.isInteger(Number(input.contactId)) ? Number(input.contactId) : null,
      recipientEmail: String(input.recipientEmail || ''),
      ccRecipients: String(input.ccRecipients || ''),
      subject: String(input.subject || ''),
      body: String(input.body || ''),
      operationKey: String(input.operationKey || ''),
      userId: user.userId,
    });
    const result = await sendCustomerServiceReply(user.businessId, draftId, user.userId);
    return NextResponse.json({ success: true, draftId, threadId, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: String(error?.message || 'Message could not be sent') },
      { status: 409 },
    );
  }
}
