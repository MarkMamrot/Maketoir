import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getPool, query } from '@/services/MySQLService';

const STATUSES = new Set(['new', 'triaging', 'confirmed_defect', 'confirmed_gap', 'intentional_design', 'planned', 'duplicate', 'declined', 'resolved']);

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid finding id.' }, { status: 400 });
  const [findings, events, cases] = await Promise.all([
    query<any>(
      `SELECT wf.*, u.name AS assigned_name
         FROM assistant_workflow_findings wf
         LEFT JOIN users u ON u.id = wf.assigned_to
        WHERE wf.id = ? LIMIT 1`, [id],
    ),
    query<any>(
      `SELECT wfe.*, u.name AS actor_name
         FROM assistant_workflow_finding_events wfe
         LEFT JOIN users u ON u.id = wfe.actor_id
        WHERE wfe.finding_id = ? ORDER BY wfe.created_at DESC, wfe.id DESC LIMIT 200`, [id],
    ),
    query<any>(
      `SELECT ae.id, ae.public_reference, ae.business_id, COALESCE(b.name, ae.business_id) AS business_name,
              ae.audience, ae.actor_type, ae.actor_id, ae.can_follow_up_directly, ae.current_view,
              ae.status, ae.response_due_at, ae.acknowledged_at, ae.followed_up_at,
              ae.assigned_to, u.name AS assigned_name, ae.created_at
         FROM assistant_escalations ae
         LEFT JOIN businesses b ON b.business_id = ae.business_id
         LEFT JOIN users u ON u.id = ae.assigned_to
        WHERE ae.workflow_finding_id = ? ORDER BY ae.response_due_at, ae.id`, [id],
    ),
  ]);
  if (!findings[0]) return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
  return NextResponse.json({ success: true, finding: findings[0], events, cases });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid finding id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as { status?: string; resolutionNotes?: string; assignedTo?: number | null } | null;
  if (!body?.status || !STATUSES.has(body.status)) return NextResponse.json({ error: 'Invalid finding status.' }, { status: 400 });
  const assignedTo = body.assignedTo == null ? null : Number(body.assignedTo);
  if (assignedTo != null && (!Number.isInteger(assignedTo) || assignedTo <= 0)) {
    return NextResponse.json({ error: 'assignedTo must be a valid user id or null.' }, { status: 400 });
  }
  const notes = String(body.resolutionNotes ?? '').trim().slice(0, 10_000) || null;
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      'SELECT status, assigned_to FROM assistant_workflow_findings WHERE id = ? LIMIT 1 FOR UPDATE', [id],
    );
    if (!rows[0]) {
      await connection.rollback();
      return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
    }
    await connection.execute(
      'UPDATE assistant_workflow_findings SET status = ?, assigned_to = ?, resolution_notes = ? WHERE id = ?',
      [body.status, assignedTo, notes, id],
    );
    await connection.execute(
      `INSERT INTO assistant_workflow_finding_events
         (finding_id, event_type, message, evidence_json, actor_id)
       VALUES (?, 'status_changed', ?, ?, ?)`,
      [id, `Status changed from ${rows[0].status} to ${body.status}`, JSON.stringify({
        previous_status: rows[0].status, status: body.status,
        previous_assigned_to: rows[0].assigned_to, assigned_to: assignedTo, resolution_notes: notes,
      }), auth.user.userId],
    );
    if (body.status === 'intentional_design') {
      await connection.execute(
        `INSERT INTO assistant_workflow_finding_events
           (finding_id, event_type, message, actor_id)
         VALUES (?, 'documentation_requested', ?, ?)`,
        [id, 'Document the intentional supported workflow in the reviewed assistant knowledge corpus.', auth.user.userId],
      );
    }
    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}