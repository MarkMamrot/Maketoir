import { NextResponse } from 'next/server';

import { getPosSession } from '@/lib/sessionUtils';
import { createSupportTicket, getSupportTicket } from '@/lib/supportTickets';
import { sendNewSupportTicketAlert } from '@/lib/supportTicketAlerts';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { readSupportTicketSubmission, SupportTicketValidationError } from '@/lib/supportTicketImages';

export async function POST(request: Request) {
  const session = getPosSession() as (ReturnType<typeof getPosSession> & { businessId?: string });
  if (!session?.businessId || !session.pos_user_id) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body;
  try { body = await readSupportTicketSubmission(request); }
  catch (error) {
    if (error instanceof SupportTicketValidationError || error instanceof SyntaxError || error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  let id: number;
  try { id = await createSupportTicket({
    businessId: session.businessId,
    submittedByUserId: session.pos_user_id,
    submittedByName: session.full_name ?? null,
    submittedByEmail: null,
    sourceApp: 'pos',
    screenContext: body.screenContext,
    subject: body.subject,
    description: body.description,
  }, body.images); }
  catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'support-tickets', operation: 'create_ticket', title: 'Support ticket upload failed', error });
    return NextResponse.json({ error: 'Your ticket could not be saved. Please try again.' }, { status: 500 });
  }

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
