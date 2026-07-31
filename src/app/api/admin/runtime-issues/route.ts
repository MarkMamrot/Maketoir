import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';

const STATUSES = new Set(['new', 'in_progress', 'fixed']);
const SEVERITIES = new Set(['warning', 'error', 'critical']);

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const severity = url.searchParams.get('severity') || '';
  const source = url.searchParams.get('source')?.trim() || '';
  const businessId = url.searchParams.get('businessId')?.trim() || '';
  const search = url.searchParams.get('search')?.trim() || '';
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit')) || 100));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status && STATUSES.has(status)) { conditions.push('ri.status = ?'); params.push(status); }
  if (severity && SEVERITIES.has(severity)) { conditions.push('ri.severity = ?'); params.push(severity); }
  if (source) { conditions.push('ri.source = ?'); params.push(source); }
  if (businessId) { conditions.push('ri.business_id = ?'); params.push(businessId); }
  if (search) {
    conditions.push('(ri.title LIKE ? OR ri.message LIKE ? OR ri.operation LIKE ?)');
    const needle = `%${search.slice(0, 100)}%`;
    params.push(needle, needle, needle);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [issues, summary, businesses, sources] = await Promise.all([
    query<any>(
      `SELECT ri.id, ri.business_id, COALESCE(b.name, 'System') AS business_name,
              ri.source, ri.operation, ri.severity, ri.status, ri.title, ri.message,
              ri.first_seen_at, ri.last_seen_at, ri.occurrence_count,
              ri.source_reference_type, ri.source_reference_id, ri.assigned_to,
              u.name AS assigned_name, ri.fixed_at
         FROM runtime_issues ri
         LEFT JOIN businesses b ON b.business_id = ri.business_id
         LEFT JOIN users u ON u.id = ri.assigned_to
         ${where}
        ORDER BY FIELD(ri.status, 'new', 'in_progress', 'fixed'),
                 FIELD(ri.severity, 'critical', 'error', 'warning'),
                 ri.last_seen_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query<any>(
      `SELECT status, COUNT(*) AS count FROM runtime_issues GROUP BY status`,
    ),
    query<any>(
      `SELECT business_id, name FROM businesses WHERE deleted_at IS NULL ORDER BY name`,
    ),
    query<any>(
      `SELECT DISTINCT source FROM runtime_issues ORDER BY source`,
    ),
  ]);

  return NextResponse.json({ success: true, issues, summary, businesses, sources });
}