import { NextResponse } from 'next/server';

import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import {
  listXeroReconciliationIssues,
  type XeroReconciliationIssueListItem,
} from '@/lib/xero/reconciliation/repository';
import { imsQuery } from '@/services/IMSMySQLService';

type SourceDetails = { reference: string; contactName: string | null; amount: number | null; itemDate: string | Date | null };

async function loadSourceDetails(
  businessId: string,
  imsDbName: string,
  items: XeroReconciliationIssueListItem[],
): Promise<Map<string, SourceDetails>> {
  const result = new Map<string, SourceDetails>();
  const configs = [
    { type: 'purchase_order', table: 'ims_purchase_orders po', id: 'po.id', reference: 'po.po_number', amount: 'po.total_amount', date: 'po.order_date', join: 'LEFT JOIN ims_contacts c ON c.id = po.supplier_id', contact: "COALESCE(c.name, po.supplier_name_raw, '')" },
    { type: 'sales_order', table: 'ims_sales_orders so', id: 'so.id', reference: 'so.so_number', amount: 'so.total_amount', date: 'so.order_date', join: 'LEFT JOIN ims_contacts c ON c.id = so.customer_id', contact: "COALESCE(c.name, '')" },
    { type: 'customer_credit_note', table: 'ims_credit_notes cn', id: 'cn.id', reference: 'cn.cn_number', amount: 'cn.total_amount', date: 'cn.cn_date', join: 'LEFT JOIN ims_contacts c ON c.id = cn.customer_id', contact: "COALESCE(c.name, '')" },
    { type: 'supplier_credit_note', table: 'ims_supplier_credit_notes scn', id: 'scn.id', reference: 'scn.scn_number', amount: 'scn.total_amount', date: 'scn.scn_date', join: 'LEFT JOIN ims_contacts c ON c.id = scn.supplier_id', contact: "COALESCE(c.name, '')" },
  ] as const;
  for (const config of configs) {
    const ids = [...new Set(items.filter(item => item.targetType === config.type).map(item => Number(item.referenceId)).filter(Number.isFinite))];
    if (!ids.length) continue;
    const placeholders = ids.map(() => '?').join(',');
    const rows = await imsQuery<any>(
      `SELECT ${config.id} AS id, ${config.reference} AS reference, ${config.contact} AS contact_name,
              ${config.amount} AS amount, ${config.date} AS item_date
         FROM ${config.table} ${config.join}
        WHERE ${config.id} IN (${placeholders}) AND ${config.table.split(' ')[1]}.business_id = ?`,
      [...ids, businessId],
      imsDbName,
    );
    for (const row of rows) {
      result.set(`${config.type}:${row.id}`, {
        reference: String(row.reference), contactName: row.contact_name ? String(row.contact_name) : null,
        amount: row.amount == null ? null : Number(row.amount), itemDate: row.item_date ?? null,
      });
    }
  }
  return result;
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function reconciliationIssuesCsv(items: Array<XeroReconciliationIssueListItem & SourceDetails>): string {
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
    const details = await loadSourceDetails(databaseId!, imsDbName, result.items);
    const items = result.items.map(item => ({
      ...item,
      ...(details.get(`${item.targetType}:${item.referenceId}`) ?? {
        reference: `${item.targetType} #${item.referenceId}`, contactName: null, amount: null, itemDate: null,
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