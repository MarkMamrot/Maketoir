import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getSupportTicket, isSupportTicketStatus, listSupportTicketUpdates, saveSupportTicketUpdate } from '@/lib/supportTickets';
import { listSupportImages } from '@/lib/supportTicketImages';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { sendSupportTicketUpdateEmail } from '@/lib/supportTicketAlerts';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid ticket id.' }, { status: 400 });

  const ticket = await getSupportTicket(id);
  if (!ticket) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  try {
    const [images, updates] = await Promise.all([listSupportImages(id), listSupportTicketUpdates(id)]);
    return NextResponse.json({ success: true, ticket: { ...ticket, images, updates } });
  } catch (error) {
    await reportRuntimeIssue({ businessId: ticket.business_id, source: 'support-tickets', operation: 'list_images', title: 'Support ticket images could not be loaded', error, reference: { type: 'support_ticket', id } });
    return NextResponse.json({ error: 'Ticket images could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid ticket id.' }, { status: 400 });

  const body = await request.json().catch(() => null) as {
    status?: string;
    assignedTo?: number | null;
    resolutionNotes?: string;
    message?: string;
    requestId?: string;
    retryUpdateId?: number;
  } | null;
  if (!body?.status || !isSupportTicketStatus(body.status)) {
    return NextResponse.json({ error: 'status must be open, in_progress, resolved, or closed.' }, { status: 400 });
  }
  const assignedTo = body.assignedTo == null ? null : Number(body.assignedTo);
  if (assignedTo != null && (!Number.isInteger(assignedTo) || assignedTo <= 0)) {
    return NextResponse.json({ error: 'assignedTo must be a valid user id or null.' }, { status: 400 });
  }

  const existing = await getSupportTicket(id);
  if (!existing) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

  const message = body.message ?? body.resolutionNotes ?? '';
  if (typeof message !== 'string' || message.length > 10_000) return NextResponse.json({ error: 'Update must be at most 10,000 characters.' }, { status: 400 });
  if (!body.retryUpdateId && (typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId))) {
    return NextResponse.json({ error: 'A valid update request id is required.' }, { status: 400 });
  }
  try {
    const update = body.retryUpdateId
      ? (await listSupportTicketUpdates(id)).find(item => item.id === Number(body.retryUpdateId))
      : await saveSupportTicketUpdate(id, {
        status: body.status, assignedTo, message, requestId: body.requestId!, authorName: auth.user.name,
      });
    if (body.retryUpdateId && !update) return NextResponse.json({ error: 'Update not found.' }, { status: 404 });
    const emailStatus = update ? await sendSupportTicketUpdateEmail(existing, update) : null;
    return NextResponse.json({ success: true, emailStatus });
  } catch (error) {
    await reportRuntimeIssue({ businessId: existing.business_id, source: 'support-tickets', operation: 'post_update', title: 'Support ticket update could not complete', error, reference: { type: 'support_ticket', id } });
    return NextResponse.json({ error: 'The update could not complete. Retry the same update.' }, { status: 500 });
  }
}
