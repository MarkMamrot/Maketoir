import { NextResponse } from 'next/server';

import { getPosSession } from '@/lib/sessionUtils';
import { createSupportTicket, getSupportTicket } from '@/lib/supportTickets';
import { sendNewSupportTicketAlert } from '@/lib/supportTicketAlerts';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const session = getPosSession() as (ReturnType<typeof getPosSession> & { businessId?: string });
  if (!session?.businessId || !session.pos_user_id) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { subject?: string; description?: string; screenContext?: string } | null;
  const subject = body?.subject?.trim() ?? '';
  const description = body?.description?.trim() ?? '';
  if (!subject || !description) {
    return NextResponse.json({ error: 'subject and description are required.' }, { status: 400 });
  }

  const id = await createSupportTicket({
    businessId: session.businessId,
    submittedByUserId: session.pos_user_id,
    submittedByName: session.full_name ?? null,
    submittedByEmail: null,
    sourceApp: 'pos',
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
      businessId: session.businessId,
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
