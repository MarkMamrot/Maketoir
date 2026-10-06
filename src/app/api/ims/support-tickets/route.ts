import { NextResponse } from 'next/server';

import { requireAdminSession } from '@/lib/sessionUtils';
import { createSupportTicket, getSupportTicket } from '@/lib/supportTickets';
import { sendNewSupportTicketAlert } from '@/lib/supportTicketAlerts';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { readSupportTicketSubmission, SupportTicketValidationError } from '@/lib/supportTicketImages';

export async function POST(request: Request) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;

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
    businessId: auth.user.businessId,
    submittedByUserId: auth.user.userId,
    submittedByName: auth.user.name,
    submittedByEmail: auth.user.email,
    sourceApp: 'ims',
    screenContext: body.screenContext,
    subject: body.subject,
    description: body.description,
  }, body.images); }
  catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'support-tickets', operation: 'create_ticket', title: 'Support ticket upload failed', error });
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
