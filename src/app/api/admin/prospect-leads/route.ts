import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';
import { getLeadCapabilities, PROSPECT_LEAD_STATUSES, validateDateParameter } from './helpers';

async function leadSchema() {
  const rows = await query<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prospect_leads'`,
  );
  const columns = rows.map(row => row.COLUMN_NAME);
  return { columns: new Set(columns), capabilities: getLeadCapabilities(columns) };
}

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const search = url.searchParams.get('search')?.trim() || '';
  const integration = url.searchParams.get('integration')?.trim() || '';
  const source = url.searchParams.get('source')?.trim() || '';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const assignee = url.searchParams.get('assignee') || '';
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit')) || 100));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  if (status && !PROSPECT_LEAD_STATUSES.includes(status as typeof PROSPECT_LEAD_STATUSES[number])) {
    return NextResponse.json({ error: 'Invalid lead status.' }, { status: 400 });
  }
  const fromError = from ? validateDateParameter(from, 'from') : null;
  const toError = to ? validateDateParameter(to, 'to') : null;
  if (fromError || toError) return NextResponse.json({ error: fromError || toError }, { status: 400 });

  try {
    const { columns, capabilities } = await leadSchema();
    if (assignee && !capabilities.assignment) {
      return NextResponse.json({ error: 'Lead assignment is not available in the current schema.' }, { status: 400 });
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) { conditions.push('pl.status = ?'); params.push(status); }
    if (search) {
      conditions.push('(pl.name LIKE ? OR pl.company LIKE ? OR pl.email LIKE ? OR pl.phone LIKE ?)');
      const needle = `%${search.slice(0, 100)}%`;
      params.push(needle, needle, needle, needle);
    }
    if (integration) {
      conditions.push(`(pl.current_systems LIKE ? OR EXISTS (
        SELECT 1 FROM sales_integration_events sie
        LEFT JOIN sales_integration_offerings sio ON sio.id = sie.offering_id
        WHERE sie.conversation_id = pl.conversation_id
          AND (sie.provider_name LIKE ? OR sio.name LIKE ? OR sio.slug LIKE ?)
      ))`);
      const needle = `%${integration.slice(0, 100)}%`;
      params.push(needle, needle, needle, needle);
    }
    if (source) {
      conditions.push(`(pl.source_path = ? OR pc.source_path = ?
        OR JSON_UNQUOTE(JSON_EXTRACT(pc.attribution_json, '$.sourcePath')) = ?)`);
      params.push(source, source, source);
    }
    if (from) { conditions.push('pl.created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { conditions.push('pl.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }
    if (assignee) {
      const assignedTo = Number(assignee);
      if (!Number.isInteger(assignedTo) || assignedTo <= 0) return NextResponse.json({ error: 'Invalid assignee filter.' }, { status: 400 });
      conditions.push('pl.assigned_to = ?'); params.push(assignedTo);
    }
    const optionalSelect = [
      columns.has('assigned_to') ? 'pl.assigned_to' : 'NULL AS assigned_to',
      columns.has('notes') ? 'pl.notes' : 'NULL AS notes',
      columns.has('loss_reason') ? 'pl.loss_reason' : 'NULL AS loss_reason',
    ].join(', ');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [leads, countRows, statuses, integrations, sources] = await Promise.all([
      query<any>(
        `SELECT pl.id, pl.conversation_id, pl.name, pl.company, pl.email, pl.phone,
                pl.preferred_contact, pl.locations, pl.current_systems, pl.timeframe,
                pl.source_path, pl.status, pl.created_at, pl.updated_at, ${optionalSelect},
                pc.status AS conversation_status, pc.last_user_prompt, pc.last_message_at
           FROM prospect_leads pl
           LEFT JOIN prospect_conversations pc ON pc.id = pl.conversation_id
           ${where}
          ORDER BY pl.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM prospect_leads pl
         LEFT JOIN prospect_conversations pc ON pc.id = pl.conversation_id ${where}`,
        params,
      ),
      query<any>('SELECT status, COUNT(*) AS count FROM prospect_leads GROUP BY status'),
      query<any>(
        `SELECT provider, COUNT(*) AS count FROM (
           SELECT NULLIF(TRIM(current_systems), '') AS provider FROM prospect_leads
           UNION ALL SELECT NULLIF(TRIM(provider_name), '') FROM sales_integration_events
         ) values_by_provider WHERE provider IS NOT NULL GROUP BY provider ORDER BY count DESC, provider LIMIT 100`,
      ),
      query<any>(
        `SELECT source, COUNT(*) AS count FROM (
           SELECT NULLIF(TRIM(source_path), '') AS source FROM prospect_leads
           UNION ALL SELECT NULLIF(TRIM(source_path), '') FROM prospect_conversations
         ) values_by_source WHERE source IS NOT NULL GROUP BY source ORDER BY count DESC, source LIMIT 100`,
      ),
    ]);
    return NextResponse.json({
      success: true, leads, total: Number(countRows[0]?.count ?? 0), statuses, integrations, sources, capabilities,
    });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'list_prospect_leads', title: 'Prospect leads failed to load', error,
      context: { status, has_search: Boolean(search), has_integration: Boolean(integration), has_source: Boolean(source), from, to, has_assignee: Boolean(assignee) },
    });
    return NextResponse.json({ error: 'Prospect leads could not be loaded.' }, { status: 500 });
  }
}