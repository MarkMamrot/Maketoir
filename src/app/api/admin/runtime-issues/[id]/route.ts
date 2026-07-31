import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getPool, query } from '@/services/MySQLService';

const STATUSES = new Set(['new', 'in_progress', 'fixed']);

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid issue id.' }, { status: 400 });

  const [issues, events] = await Promise.all([
    query<any>(
      `SELECT ri.*, COALESCE(b.name, 'System') AS business_name, u.name AS assigned_name
         FROM runtime_issues ri
         LEFT JOIN businesses b ON b.business_id = ri.business_id
         LEFT JOIN users u ON u.id = ri.assigned_to
        WHERE ri.id = ? LIMIT 1`,
      [id],
    ),
    query<any>(
      `SELECT rie.*, u.name AS actor_name
         FROM runtime_issue_events rie
         LEFT JOIN users u ON u.id = rie.actor_id
        WHERE rie.issue_id = ? ORDER BY rie.created_at DESC, rie.id DESC LIMIT 200`,
      [id],
    ),
  ]);
  if (!issues[0]) return NextResponse.json({ error: 'Issue not found.' }, { status: 404 });
  return NextResponse.json({ success: true, issue: issues[0], events });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid issue id.' }, { status: 400 });

  const body = await request.json().catch(() => null) as {
    status?: string;
    resolutionNotes?: string;
    assignedTo?: number | null;
  } | null;
  if (!body?.status || !STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'status must be new, in_progress, or fixed.' }, { status: 400 });
  }
  const assignedTo = body.assignedTo == null ? null : Number(body.assignedTo);
  if (assignedTo != null && (!Number.isInteger(assignedTo) || assignedTo <= 0)) {
    return NextResponse.json({ error: 'assignedTo must be a valid user id or null.' }, { status: 400 });
  }
  const notes = String(body.resolutionNotes ?? '').trim().slice(0, 10_000) || null;
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      `SELECT status, assigned_to FROM runtime_issues WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) {
      await connection.rollback();
      return NextResponse.json({ error: 'Issue not found.' }, { status: 404 });
    }
    await connection.execute(
      `UPDATE runtime_issues
          SET status = ?, assigned_to = ?, resolution_notes = ?,
              fixed_at = IF(? = 'fixed', NOW(3), NULL)
        WHERE id = ?`,
      [body.status, assignedTo, notes, body.status, id],
    );
    await connection.execute(
      `INSERT INTO runtime_issue_events
         (issue_id, event_type, message, context, actor_id)
       VALUES (?, 'status_changed', ?, ?, ?)`,
      [
        id,
        `Status changed from ${rows[0].status} to ${body.status}`,
        JSON.stringify({
          previous_status: rows[0].status,
          status: body.status,
          previous_assigned_to: rows[0].assigned_to,
          assigned_to: assignedTo,
          resolution_notes: notes,
        }),
        auth.user.userId,
      ],
    );
    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}