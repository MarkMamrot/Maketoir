import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getSupportTicket, isSupportTicketStatus, updateSupportTicket } from '@/lib/supportTickets';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid ticket id.' }, { status: 400 });

  const ticket = await getSupportTicket(id);
  if (!ticket) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  return NextResponse.json({ success: true, ticket });
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

  await updateSupportTicket(id, {
    status: body.status,
    assignedTo,
    resolutionNotes: body.resolutionNotes ?? null,
  });
  return NextResponse.json({ success: true });
}
