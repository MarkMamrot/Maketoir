import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { updateCustomerServiceMailboxState } from '@/lib/customer-service/mailboxActions';
import { isGmailInsufficientScopeError } from '@/lib/customer-service/gmailClient';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const body = await req.json();
    if (!['read', 'unread', 'archive', 'spam'].includes(body.action)) {
      return NextResponse.json({ error: 'Invalid mailbox action' }, { status: 400 });
    }
    await updateCustomerServiceMailboxState({ businessId: user.businessId, threadId: Number(params.id), action: body.action });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId: user.businessId,
      source: 'CustomerServiceMailbox',
      operation: 'update_mailbox_state',
      severity: 'warning',
      title: 'Customer-service mailbox action failed',
      error,
      context: { threadId: Number(params.id) },
      reference: { type: 'customer_service_thread', id: params.id },
    });
    if (isGmailInsufficientScopeError(error)) {
      return NextResponse.json(
        {
          success: false,
          reconnectRequired: true,
          error: 'Gmail connection is missing required mailbox scope (gmail.modify). Reconnect Gmail from Setup > Connections, then retry.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}