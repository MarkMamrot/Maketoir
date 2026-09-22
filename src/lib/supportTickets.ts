import { execute, query } from '@/services/MySQLService';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportTicketSourceApp = 'ims' | 'pos';

export interface SupportTicket {
  id: number;
  business_id: string | null;
  business_name: string;
  submitted_by_user_id: number | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  source_app: SupportTicketSourceApp;
  screen_context: string | null;
  subject: string;
  description: string;
  status: SupportTicketStatus;
  assigned_to: number | null;
  assigned_name: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSupportTicketInput {
  businessId: string | null;
  submittedByUserId: number | null;
  submittedByName: string | null;
  submittedByEmail: string | null;
  sourceApp: SupportTicketSourceApp;
  screenContext: string | null;
  subject: string;
  description: string;
}

const STATUSES = new Set<SupportTicketStatus>(['open', 'in_progress', 'resolved', 'closed']);

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === 'string' && STATUSES.has(value as SupportTicketStatus);
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<number> {
  const subject = input.subject.trim().slice(0, 255);
  const description = input.description.trim().slice(0, 10_000);
  if (!subject || !description) throw new Error('subject and description are required.');

  const result = await execute(
    `INSERT INTO support_tickets
       (business_id, submitted_by_user_id, submitted_by_name, submitted_by_email,
        source_app, screen_context, subject, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      input.businessId,
      input.submittedByUserId,
      input.submittedByName,
      input.submittedByEmail,
      input.sourceApp,
      input.screenContext,
      subject,
      description,
    ],
  );
  return result.insertId;
}

export interface ListSupportTicketsFilters {
  status?: string;
  businessId?: string;
  assignedTo?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listSupportTickets(filters: ListSupportTicketsFilters): Promise<SupportTicket[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status && isSupportTicketStatus(filters.status)) { conditions.push('st.status = ?'); params.push(filters.status); }
  if (filters.businessId) { conditions.push('st.business_id = ?'); params.push(filters.businessId); }
  if (filters.assignedTo) { conditions.push('st.assigned_to = ?'); params.push(filters.assignedTo); }
  if (filters.search?.trim()) {
    conditions.push('(st.subject LIKE ? OR st.description LIKE ?)');
    const needle = `%${filters.search.trim().slice(0, 100)}%`;
    params.push(needle, needle);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(250, Number(filters.limit) || 100));
  const offset = Math.max(0, Number(filters.offset) || 0);

  return query<SupportTicket>(
    `SELECT st.id, st.business_id, COALESCE(b.name, 'Unknown') AS business_name,
            st.submitted_by_user_id, st.submitted_by_name, st.submitted_by_email,
            st.source_app, st.screen_context, st.subject, st.description, st.status,
            st.assigned_to, u.name AS assigned_name, st.resolution_notes,
            st.resolved_at, st.created_at, st.updated_at
       FROM support_tickets st
       LEFT JOIN businesses b ON b.business_id = st.business_id
       LEFT JOIN users u ON u.id = st.assigned_to
       ${where}
      ORDER BY FIELD(st.status, 'open', 'in_progress', 'resolved', 'closed'), st.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
}

export async function getSupportTicketStatusSummary(): Promise<Record<string, number>> {
  const rows = await query<{ status: SupportTicketStatus; count: number }>(
    `SELECT status, COUNT(*) AS count FROM support_tickets GROUP BY status`,
  );
  return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
}

export async function getOpenSupportTicketCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM support_tickets WHERE status IN ('open', 'in_progress')`,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getSupportTicket(id: number): Promise<SupportTicket | null> {
  const rows = await query<SupportTicket>(
    `SELECT st.*, COALESCE(b.name, 'Unknown') AS business_name, u.name AS assigned_name
       FROM support_tickets st
       LEFT JOIN businesses b ON b.business_id = st.business_id
       LEFT JOIN users u ON u.id = st.assigned_to
      WHERE st.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface UpdateSupportTicketInput {
  status: SupportTicketStatus;
  assignedTo: number | null;
  resolutionNotes: string | null;
}

export async function updateSupportTicket(id: number, input: UpdateSupportTicketInput): Promise<void> {
  const notes = input.resolutionNotes?.trim().slice(0, 10_000) || null;
  await execute(
    `UPDATE support_tickets
        SET status = ?, assigned_to = ?, resolution_notes = ?,
            resolved_at = IF(? IN ('resolved','closed'), COALESCE(resolved_at, NOW(3)), NULL)
      WHERE id = ?`,
    [input.status, input.assignedTo, notes, input.status, id],
  );
}

export async function getSupportTicketNotificationEmail(): Promise<string> {
  const rows = await query<{ notification_email: string | null }>(
    `SELECT notification_email FROM support_ticket_settings WHERE id = 1 LIMIT 1`,
  );
  return (rows[0]?.notification_email ?? '').trim();
}

export async function setSupportTicketNotificationEmail(email: string): Promise<void> {
  const normalized = email.trim();
  await execute(
    `INSERT INTO support_ticket_settings (id, notification_email) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE notification_email = VALUES(notification_email)`,
    [normalized || null],
  );
}

export async function listAssignableSupportUsers(): Promise<Array<{ id: number; name: string; email: string }>> {
  return query<{ id: number; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE tier = 'SuperAdmin' AND deleted_at IS NULL ORDER BY name`,
  );
}
