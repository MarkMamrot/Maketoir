import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getSupportTicketNotificationEmail, setSupportTicketNotificationEmail } from '@/lib/supportTickets';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const notificationEmail = await getSupportTicketNotificationEmail();
  return NextResponse.json({ success: true, notificationEmail });
}

export async function PUT(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null) as { notificationEmail?: string } | null;
  const email = body?.notificationEmail?.trim() ?? '';
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'notificationEmail must be a valid email address.' }, { status: 400 });
  }
  await setSupportTicketNotificationEmail(email);
  return NextResponse.json({ success: true });
}
