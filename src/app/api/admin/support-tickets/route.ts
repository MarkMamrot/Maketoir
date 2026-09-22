import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getSupportTicketStatusSummary, listSupportTickets } from '@/lib/supportTickets';
import { query } from '@/services/MySQLService';

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const businessId = url.searchParams.get('businessId')?.trim() || '';
  const assignedTo = Number(url.searchParams.get('assignedTo')) || undefined;
  const search = url.searchParams.get('search')?.trim() || '';
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit')) || 100));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  try {
    const [tickets, summary, businesses] = await Promise.all([
      listSupportTickets({ status, businessId, assignedTo, search, limit, offset }),
      getSupportTicketStatusSummary(),
      query<{ business_id: string; name: string }>(
        `SELECT DISTINCT st.business_id, b.name
           FROM support_tickets st
           LEFT JOIN businesses b ON b.business_id = st.business_id
          WHERE st.business_id IS NOT NULL
          ORDER BY b.name`,
      ),
    ]);
    return NextResponse.json({ success: true, tickets, summary, businesses });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin',
      operation: 'list_support_tickets',
      severity: 'error',
      title: 'Support Tickets admin list failed to load',
      error,
      context: { status, has_business_filter: Boolean(businessId), has_search: Boolean(search) },
    });
    return NextResponse.json({ error: 'Support tickets could not be loaded.' }, { status: 500 });
  }
}
