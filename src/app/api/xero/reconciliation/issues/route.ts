import { NextResponse } from 'next/server';

import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import {
  listXeroReconciliationIssues,
  type XeroReconciliationIssueListItem,
} from '@/lib/xero/reconciliation/repository';
import { loadXeroReconciliationSourceDetails, type XeroReconciliationSourceDetails } from '@/lib/xero/reconciliation/sourceDetails';

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function reconciliationIssuesCsv(items: Array<XeroReconciliationIssueListItem & XeroReconciliationSourceDetails>): string {
  const headers = ['Severity', 'State', 'Discrepancy', 'Document type', 'Reference', 'Contact', 'Amount', 'First seen', 'Last checked', 'Summary', 'Expected', 'Xero actual', 'Recommended next step', 'Xero ID'];
  const rows = items.map(item => [
    item.severity, item.status, item.ruleKey, item.targetType, item.reference, item.contactName,
    item.amount, item.firstSeenAt, item.lastCheckedAt, item.summary,
    JSON.stringify(item.expected ?? {}), JSON.stringify(item.actual ?? {}), item.recommendedNextStep, item.xeroId,
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export async function GET(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!['Admin', 'SuperAdmin', 'Advisor'].includes(user.tier)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const databaseId = params.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const imsDbName = await getImsDbNameStrict(databaseId!);
  if (!imsDbName) return NextResponse.json({ error: 'IMS tenant database is not configured.' }, { status: 409 });

  try {
    const format = params.get('format');
    const result = await listXeroReconciliationIssues({
      businessId: databaseId!, status: params.get('status') ?? undefined,
      severity: params.get('severity') ?? undefined, targetType: params.get('targetType') ?? undefined,
      ruleKey: params.get('ruleKey') ?? undefined, minimumAgeDays: Number(params.get('minimumAgeDays') ?? 0),
      limit: format === 'csv' ? 500 : Number(params.get('limit') ?? 100),
      offset: format === 'csv' ? 0 : Number(params.get('offset') ?? 0),
    });
    const details = await loadXeroReconciliationSourceDetails(databaseId!, imsDbName, result.items);
    const items = result.items.map(item => ({
      ...item,
      ...(details.get(`${item.targetType}:${item.referenceId}`) ?? {
        reference: `${item.targetType} #${item.referenceId}`, contactName: null, amount: null, itemDate: null, status: null,
      }),
    }));
    if (format === 'csv') {
      return new Response(reconciliationIssuesCsv(items), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="xero-needs-attention-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return NextResponse.json({ items, total: result.total });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId, source: 'xero_reconciliation', operation: 'list_issues',
      title: 'Xero reconciliation issues could not be loaded', error,
    });
    return NextResponse.json({ error: 'Reconciliation issues could not be loaded.' }, { status: 500 });
  }
}