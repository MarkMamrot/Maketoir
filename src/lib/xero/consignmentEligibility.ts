import { imsQuery } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const CONSIGNMENT_XERO_EXCLUSION = 'Consignment: intentionally excluded from Xero purchasing and owned inventory accounting.';

export function isConsignmentSnapshot(value: { consignment_supplier_id?: number | string | null }): boolean {
  return value.consignment_supplier_id != null;
}

async function rejectUnknownOwnership(businessId: string, type: string, id: string | number): Promise<never> {
  const error = new Error(`Xero posting blocked: persisted ${type} ownership could not be verified. Reload the source document before retrying.`);
  await reportRuntimeIssue({
    businessId, source: 'xero_consignment_eligibility', operation: 'verify_persisted_ownership',
    title: 'Xero posting blocked because source ownership is unavailable', error,
    reference: { type, id },
  }).catch(() => {});
  throw error;
}

/** Read the immutable document snapshot, not today's supplier setting or a caller's partial DTO. */
export async function isConsignmentPurchase(
  businessId: string,
  type: 'purchase_order' | 'supplier_credit_note',
  id: number,
): Promise<boolean> {
  const table = type === 'purchase_order' ? 'ims_purchase_orders' : 'ims_supplier_credit_notes';
  const rows = await imsQuery<{ consignment_supplier_id: number | null }>(
    `SELECT consignment_supplier_id FROM ${table} WHERE id = ? AND business_id = ? LIMIT 1`,
    [id, businessId],
  );
  const row = rows?.[0];
  if (!row || row.consignment_supplier_id === undefined) {
    return rejectUnknownOwnership(businessId, type, id);
  }
  return isConsignmentSnapshot(row);
}

export async function assertOwnedSupplierCredit(businessId: string, xeroId: string): Promise<void> {
  const rows = await imsQuery<{ consignment_supplier_id: number | null }>(
    `SELECT consignment_supplier_id FROM ims_supplier_credit_notes
      WHERE xero_credit_note_id = ? AND business_id = ? LIMIT 1`,
    [xeroId, businessId],
  );
  if (rows?.[0]) {
    if (rows[0].consignment_supplier_id === undefined) {
      return rejectUnknownOwnership(businessId, 'supplier_credit_note', xeroId);
    }
    if (isConsignmentSnapshot(rows[0])) throw new Error(CONSIGNMENT_XERO_EXCLUSION);
    return;
  }
  const customerCredits = await imsQuery<{ id: number }>(
    `SELECT id FROM ims_credit_notes WHERE xero_credit_note_id = ? AND business_id = ? LIMIT 1`,
    [xeroId, businessId],
  );
  if (!customerCredits?.[0]) return rejectUnknownOwnership(businessId, 'credit_note', xeroId);
}
