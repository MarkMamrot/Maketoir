import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';

const STATUSES = new Set(['new', 'triaging', 'confirmed_defect', 'confirmed_gap', 'intentional_design', 'planned', 'duplicate', 'declined', 'resolved']);
const IMPACTS = new Set(['low', 'medium', 'high', 'critical']);

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const impact = url.searchParams.get('impact') || '';
  const capability = url.searchParams.get('capability')?.trim() || '';
  const search = url.searchParams.get('search')?.trim() || '';
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit')) || 100));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status && STATUSES.has(status)) { conditions.push('wf.status = ?'); params.push(status); }
  if (impact && IMPACTS.has(impact)) { conditions.push('wf.impact = ?'); params.push(impact); }
  if (capability) { conditions.push('wf.capability = ?'); params.push(capability); }
  if (search) {
    conditions.push('(wf.title LIKE ? OR wf.capability LIKE ? OR wf.category LIKE ?)');
    const needle = `%${search.slice(0, 100)}%`;
    params.push(needle, needle, needle);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const [findings, summary, capabilities] = await Promise.all([
      query<any>(
        `SELECT wf.id, wf.category, wf.impact, wf.confidence, wf.status, wf.capability,
                wf.title, wf.audiences_json, wf.first_seen_at, wf.last_seen_at,
                wf.occurrence_count, wf.affected_business_count, wf.assigned_to,
                u.name AS assigned_name, COUNT(ae.id) AS escalation_count,
                SUM(CASE WHEN ae.status IN ('open','acknowledged','investigating') THEN 1 ELSE 0 END) AS open_escalation_count,
                MIN(CASE WHEN ae.status IN ('open','acknowledged','investigating') THEN ae.response_due_at END) AS next_response_due_at
           FROM assistant_workflow_findings wf
           LEFT JOIN users u ON u.id = wf.assigned_to
           LEFT JOIN assistant_escalations ae ON ae.workflow_finding_id = wf.id
           ${where}
          GROUP BY wf.id
          ORDER BY FIELD(wf.status, 'new','triaging','confirmed_defect','confirmed_gap','planned','intentional_design','duplicate','declined','resolved'),
                   FIELD(wf.impact, 'critical','high','medium','low'), wf.last_seen_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      query<any>('SELECT status, COUNT(*) AS count FROM assistant_workflow_findings GROUP BY status'),
      query<any>('SELECT DISTINCT capability FROM assistant_workflow_findings ORDER BY capability'),
    ]);
    return NextResponse.json({ success: true, findings, summary, capabilities });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'list_workflow_findings', severity: 'error',
      title: 'Workflow findings admin list failed to load', error,
      context: { status, impact, capability, has_search: Boolean(search) },
    });
    return NextResponse.json({ error: 'Workflow findings could not be loaded.' }, { status: 500 });
  }
}