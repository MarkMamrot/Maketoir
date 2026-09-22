import { NextResponse } from 'next/server';

import { requireAdminSession } from '@/lib/sessionUtils';
import { createSupportTicket, getSupportTicket } from '@/lib/supportTickets';
import { sendNewSupportTicketAlert } from '@/lib/supportTicketAlerts';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null) as { subject?: string; description?: string; screenContext?: string } | null;
  const subject = body?.subject?.trim() ?? '';
  const description = body?.description?.trim() ?? '';
  if (!subject || !description) {
    return NextResponse.json({ error: 'subject and description are required.' }, { status: 400 });
  }

  const id = await createSupportTicket({
    businessId: auth.user.businessId,
    submittedByUserId: auth.user.userId,
    submittedByName: auth.user.name,
    submittedByEmail: auth.user.email,
    sourceApp: 'ims',
    screenContext: body?.screenContext?.trim().slice(0, 255) || null,
    subject,
    description,
  });

  try {
    const ticket = await getSupportTicket(id);
    if (ticket) {
      await sendNewSupportTicketAlert({
        id: ticket.id,
        businessName: ticket.business_name,
        sourceApp: ticket.source_app,
        screenContext: ticket.screen_context,
        submittedByName: ticket.submitted_by_name,
        submittedByEmail: ticket.submitted_by_email,
        subject: ticket.subject,
        description: ticket.description,
      });
    }
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'support-tickets',
      operation: 'send_new_ticket_alert',
      severity: 'warning',
      title: 'Support ticket notification email failed to send',
      error,
      reference: { type: 'support_ticket', id },
    });
  }

  return NextResponse.json({ success: true, id });
}
