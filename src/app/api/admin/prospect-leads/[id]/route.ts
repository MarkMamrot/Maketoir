import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getPool, query } from '@/services/MySQLService';
import { getLeadCapabilities, PROSPECT_LEAD_STATUSES } from '../helpers';

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function schemaColumns(): Promise<Set<string>> {
  const rows = await query<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prospect_leads'`,
  );
  return new Set(rows.map(row => row.COLUMN_NAME));
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid lead id.' }, { status: 400 });
  try {
    const columns = await schemaColumns();
    const capabilities = getLeadCapabilities(columns);
    const optionalSelect = [
      columns.has('assigned_to') ? 'pl.assigned_to' : 'NULL AS assigned_to',
      columns.has('notes') ? 'pl.notes' : 'NULL AS notes',
      columns.has('loss_reason') ? 'pl.loss_reason' : 'NULL AS loss_reason',
    ].join(', ');
    const leads = await query<any>(
      `SELECT pl.*, ${optionalSelect}, pc.status AS conversation_status, pc.source_path AS conversation_source_path,
              pc.attribution_json, pc.last_user_prompt, pc.message_count, pc.last_message_at
         FROM prospect_leads pl LEFT JOIN prospect_conversations pc ON pc.id = pl.conversation_id
        WHERE pl.id = ? LIMIT 1`, [id],
    );
    if (!leads[0]) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    const conversationId = leads[0].conversation_id;
    const [messages, promptRows, events] = await Promise.all([
      conversationId
        ? query<any>('SELECT id, role, content, model_name, prompt_version, metadata_json, created_at FROM prospect_messages WHERE conversation_id = ? ORDER BY created_at, id', [conversationId])
        : Promise.resolve([]),
      conversationId
        ? query<any>("SELECT id, content, created_at FROM prospect_messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 3", [conversationId])
        : Promise.resolve([]),
      query<any>('SELECT id, event_type, event_data_json, created_at FROM prospect_lead_events WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', [id]),
    ]);
    return NextResponse.json({
      success: true, lead: leads[0], conversation: { messages, finalUserPrompts: promptRows.reverse() }, events, capabilities,
    });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'get_prospect_lead', title: 'Prospect lead detail failed to load', error,
      context: { lead_id: id }, reference: { type: 'prospect_lead', id },
    });
    return NextResponse.json({ error: 'Prospect lead could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid lead id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  try {
    const columns = await schemaColumns();
    const capabilities = getLeadCapabilities(columns);
    const updates: Array<{ column: string; value: unknown }> = [];
    if ('status' in body) {
      if (!PROSPECT_LEAD_STATUSES.includes(body.status as typeof PROSPECT_LEAD_STATUSES[number])) {
        return NextResponse.json({ error: 'Invalid lead status.' }, { status: 400 });
      }
      updates.push({ column: 'status', value: body.status });
    }
    if ('assignedTo' in body) {
      if (!capabilities.assignment) return NextResponse.json({ error: 'Lead assignment is not available in the current schema.' }, { status: 400 });
      const assignedTo = body.assignedTo == null ? null : Number(body.assignedTo);
      if (assignedTo != null && (!Number.isInteger(assignedTo) || assignedTo <= 0)) {
        return NextResponse.json({ error: 'assignedTo must be a valid user id or null.' }, { status: 400 });
      }
      updates.push({ column: 'assigned_to', value: assignedTo });
    }
    for (const [property, column, supported, maximum] of [
      ['notes', 'notes', capabilities.notes, 10_000],
      ['lossReason', 'loss_reason', capabilities.lossReason, 2_000],
    ] as const) {
      if (!(property in body)) continue;
      if (!supported) return NextResponse.json({ error: `${property} is not available in the current schema.` }, { status: 400 });
      if (body[property] != null && typeof body[property] !== 'string') return NextResponse.json({ error: `${property} must be text or null.` }, { status: 400 });
      const value = typeof body[property] === 'string' ? body[property].trim() : '';
      if (value.length > maximum) return NextResponse.json({ error: `${property} must be ${maximum} characters or fewer.` }, { status: 400 });
      updates.push({ column, value: value || null });
    }
    if (!updates.length) return NextResponse.json({ error: 'No supported lead changes were supplied.' }, { status: 400 });

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const selectColumns = updates.map(update => update.column).join(', ');
      const [rows]: any = await connection.execute(`SELECT ${selectColumns} FROM prospect_leads WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
      if (!rows[0]) {
        await connection.rollback();
        return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
      }
      const before = Object.fromEntries(updates.map(update => [update.column, rows[0][update.column]]));
      const after = Object.fromEntries(updates.map(update => [update.column, update.value]));
      await connection.execute(
        `UPDATE prospect_leads SET ${updates.map(update => `${update.column} = ?`).join(', ')} WHERE id = ?`,
        [...updates.map(update => update.value), id],
      );
      await connection.execute(
        `INSERT INTO prospect_lead_events (idempotency_key, lead_id, event_type, event_data_json)
         VALUES (?, ?, 'admin_updated', ?)`,
        [randomUUID(), id, JSON.stringify({ actor_user_id: auth.user.userId, before, after })],
      );
      await connection.commit();
      return NextResponse.json({ success: true, changes: after, capabilities });
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'update_prospect_lead', title: 'Prospect lead update failed', error,
      context: { lead_id: id, fields: Object.keys(body).filter(key => ['status', 'assignedTo', 'notes', 'lossReason'].includes(key)) },
      reference: { type: 'prospect_lead', id },
    });
    return NextResponse.json({ error: 'Prospect lead could not be updated.' }, { status: 500 });
  }
}