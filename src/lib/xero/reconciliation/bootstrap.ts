import { imsQuery } from '@/services/IMSMySQLService';
import { canonicalDocumentSnapshot } from './domain';
import { insertXeroReconciliationTargetIfAbsent } from './repository';

export type BootstrapCursor = {
  purchaseOrder: number;
  salesOrder: number;
  customerCreditNote: number;
  supplierCreditNote: number;
};

type HistoricalLink = {
  id: number;
  xero_id: string;
  total_amount: number | string | null;
  currency_code: string | null;
};

const SOURCES = [
  { cursor: 'purchaseOrder', targetType: 'purchase_order', table: 'ims_purchase_orders', xeroColumn: 'xero_bill_id', documentType: 'ACCPAY', currency: 'currency_code' },
  { cursor: 'salesOrder', targetType: 'sales_order', table: 'ims_sales_orders', xeroColumn: 'xero_invoice_id', documentType: 'ACCREC', currency: 'currency_code' },
  { cursor: 'customerCreditNote', targetType: 'customer_credit_note', table: 'ims_credit_notes', xeroColumn: 'xero_credit_note_id', documentType: 'ACCRECCREDIT', currency: "'AUD'" },
  { cursor: 'supplierCreditNote', targetType: 'supplier_credit_note', table: 'ims_supplier_credit_notes', xeroColumn: 'xero_credit_note_id', documentType: 'ACCPAYCREDIT', currency: 'currency_code' },
] as const;

export async function bootstrapHistoricalXeroTargets(
  input: { businessId: string; cursors?: Partial<BootstrapCursor>; limitPerType?: number },
  dependencies: {
    queryIms?: typeof imsQuery;
    insertTarget?: typeof insertXeroReconciliationTargetIfAbsent;
  } = {},
): Promise<{ discovered: number; inserted: number; cursors: BootstrapCursor }> {
  const queryIms = dependencies.queryIms ?? imsQuery;
  const insertTarget = dependencies.insertTarget ?? insertXeroReconciliationTargetIfAbsent;
  const limit = Math.max(1, Math.min(100, Math.floor(input.limitPerType ?? 25)));
  const cursors: BootstrapCursor = {
    purchaseOrder: Math.max(0, Math.floor(input.cursors?.purchaseOrder ?? 0)),
    salesOrder: Math.max(0, Math.floor(input.cursors?.salesOrder ?? 0)),
    customerCreditNote: Math.max(0, Math.floor(input.cursors?.customerCreditNote ?? 0)),
    supplierCreditNote: Math.max(0, Math.floor(input.cursors?.supplierCreditNote ?? 0)),
  };
  let discovered = 0;
  let inserted = 0;

  for (const source of SOURCES) {
    const rows = await queryIms<HistoricalLink>(
      `SELECT id, ${source.xeroColumn} AS xero_id, total_amount, ${source.currency} AS currency_code
         FROM ${source.table}
        WHERE business_id = ? AND id > ?
          AND ${source.xeroColumn} IS NOT NULL AND ${source.xeroColumn} != ''
        ORDER BY id ASC LIMIT ${limit}`,
      [input.businessId, cursors[source.cursor]],
    );
    discovered += rows.length;
    for (const row of rows) {
      const xeroId = String(row.xero_id).trim();
      const expected = canonicalDocumentSnapshot({
        xeroId,
        documentType: source.documentType,
        currencyCode: row.currency_code,
        total: row.total_amount,
      });
      if (await insertTarget({
        businessId: input.businessId,
        targetType: source.targetType,
        referenceId: row.id,
        xeroId,
        expected,
      })) inserted += 1;
    }
    if (rows.length) cursors[source.cursor] = Number(rows.at(-1)!.id);
  }

  return { discovered, inserted, cursors };
}