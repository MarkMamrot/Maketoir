import type { XeroReconciliationIssueListItem } from './repository';
import { imsQuery } from '@/services/IMSMySQLService';

export type XeroReconciliationSourceDetails = {
  reference: string;
  contactName: string | null;
  amount: number | null;
  itemDate: string | Date | null;
};

export async function loadXeroReconciliationSourceDetails(
  businessId: string,
  imsDbName: string,
  items: XeroReconciliationIssueListItem[],
): Promise<Map<string, XeroReconciliationSourceDetails>> {
  const result = new Map<string, XeroReconciliationSourceDetails>();
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